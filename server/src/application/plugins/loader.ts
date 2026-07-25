/**
 * Plugin Loader - Discovers, loads, and manages plugins.
 *
 * This module handles the complete plugin lifecycle:
 * - Discovery: Scan plugin directories for manifests
 * - Validation: Validate manifest schema and permissions
 * - Loading: Load plugin modules
 * - Activation: Call plugin's activate() function
 * - Deactivation: Call plugin's deactivate() function and cleanup
 *
 * Usage:
 *   // Discover all plugins
 *   const manifests = await pluginLoader.discover();
 *
 *   // Activate a plugin
 *   await pluginLoader.activate('com.example.my-plugin');
 *
 *   // Deactivate a plugin
 *   await pluginLoader.deactivate('com.example.my-plugin');
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type Database from 'better-sqlite3';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type {
  PluginManifest,
  PluginInstance,
  PluginValidationResult,
  PluginContext,
  PluginModule,
} from '@zclaudia/shared/plugin-types';
import { checkPluginCompatibility } from '../../utils/version.js';
import { pluginEvents } from '../../infra/events/index.js';
import { commandRegistry } from '../commands/registry.js';
import { toolRegistry } from './tool-registry.js';
import { permissionManager } from './permissions.js';
import type { Permission } from '@zclaudia/shared/plugin-types';
import { workerHost } from './worker-host.js';
import { workflowStepRegistry } from './workflow-step-registry.js';
import { workflowTriggerRegistry } from './workflow-trigger-registry.js';
import { pluginScheduler } from './scheduler.js';
import { mcpClientManager } from '../../utils/mcp-client-manager.js';
import { loadMcpServersFromDb } from '../../utils/mcp-config.js';
import type {
  McpRequirement,
  CapabilityNegotiationResult,
  McpCapabilityStatus,
} from '@zclaudia/shared/plugin-types';
import { PluginAgentProfileService } from './agent-profile-service.js';
import { createPluginContext } from './plugin-context.js';
import {
  registerAgentRuntimeContributions,
  unregisterAgentRuntimeContributions,
} from './agent-runtime-contributions.js';
import { providerRegistry } from '../../infra/providers/registry.js';
import { AgentProfileRepository } from '../../domains/agent-profiles/repository.js';
import { managedRuntimeService } from '../managed-runtimes/service.js';

// ============================================
// Types
// ============================================

function hasDeactivate(
  module: unknown
): module is { deactivate: NonNullable<PluginModule['deactivate']> } {
  return (
    typeof module === 'object' &&
    module !== null &&
    'deactivate' in module &&
    typeof module.deactivate === 'function'
  );
}

export interface PluginLoaderOptions {
  /** Additional plugin directories to scan */
  pluginDirs?: string[];
  /** Whether to auto-activate plugins on load */
  autoActivate?: boolean;
}

// ============================================
// Plugin Loader
// ============================================

export class PluginLoader {
  private plugins = new Map<string, PluginInstance>();
  private pluginDirs: string[];
  private db: Database.Database | null = null;
  private pluginAPIs = new Map<string, unknown>();
  private broadcastFn: ((msg: ServerMessage) => void) | null = null;
  // Plugin-bundled skill directories collected during contribution registration.
  // Loaded into the shared skill cache by skill-bootstrap.loadAndCachePluginSkills,
  // which calls pi loadSourcedSkills. NOT registered as MCP tools anymore — the
  // agent reads SKILL.md via the Read tool, discovered through the
  // <available_skills> XML block in the system prompt.
  //
  // Tagged with pluginId so deactivate/remove can drop the entries.
  private pluginSkillDirs: Array<{ pluginId: string; path: string; source: 'plugin' }> = [];

  constructor(options: PluginLoaderOptions = {}) {
    // Default plugin directory: $ZCLAUDIA_DATA_DIR/plugins (same base as database).
    // Dev builds (via Tauri appDataDir + '-dev/') automatically get an isolated path.
    const dataDir = process.env.ZCLAUDIA_DATA_DIR
      ? path.resolve(process.env.ZCLAUDIA_DATA_DIR)
      : path.join(os.homedir(), '.zclaudia');
    this.pluginDirs = [path.join(dataDir, 'plugins'), ...(options.pluginDirs || [])];
  }

  /**
   * Add a plugin directory to scan (runtime only, not persisted).
   */
  addPluginDir(dir: string): void {
    if (!this.pluginDirs.includes(dir)) {
      this.pluginDirs.push(dir);
    }
  }

  /**
   * Get the effective list of plugin directories (default + user-configured).
   */
  getPluginDirs(): string[] {
    return [...this.pluginDirs, ...this.getExtraDirsFromDb()];
  }

  /**
   * Get user-configured extra plugin directories from the database.
   */
  getExtraDirsFromDb(): string[] {
    if (!this.db) return [];
    try {
      const row = this.db
        .prepare(`SELECT value FROM app_config WHERE key = 'plugin_extra_dirs'`)
        .get() as { value: string } | undefined;
      if (!row) return [];
      const dirs = JSON.parse(row.value);
      return Array.isArray(dirs) ? dirs : [];
    } catch {
      return [];
    }
  }

  /**
   * Save user-configured extra plugin directories to the database.
   */
  saveExtraDirs(dirs: string[]): void {
    if (!this.db) return;
    this.db
      .prepare(
        `
      INSERT INTO app_config (key, value) VALUES ('plugin_extra_dirs', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `
      )
      .run(JSON.stringify(dirs));
  }

  /**
   * Set the database instance for provider API access.
   */
  setDatabase(db: Database.Database): void {
    this.db = db;
  }

  /**
   * Set the broadcast function for sending messages to connected frontends.
   */
  setBroadcast(fn: (msg: ServerMessage) => void): void {
    this.broadcastFn = fn;
  }

  /**
   * Get all discovered plugins.
   */
  getPlugins(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get a specific plugin by ID.
   */
  getPlugin(pluginId: string): PluginInstance | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Check if a plugin is loaded.
   */
  hasPlugin(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  /**
   * Plugin-bundled skill directories collected during contribution registration.
   * Consumed by skill-bootstrap.loadAndCachePluginSkills to load skill content
   * via pi loadSourcedSkills and merge into the shared skill cache.
   */
  public getPluginSkillDirs(): Array<{ path: string; source: 'plugin' }> {
    return this.pluginSkillDirs.map(d => ({ path: d.path, source: d.source }));
  }

  /**
   * Discover all plugins in plugin directories.
   * Supports nested directories: if a subdirectory has no manifest file,
   * it is treated as a category folder and scanned recursively.
   */
  async discover(): Promise<PluginManifest[]> {
    const manifests: PluginManifest[] = [];

    for (const dir of this.getPluginDirs()) {
      const directManifest = await this.loadManifest(dir, { warnMissing: false });
      if (directManifest) {
        this.addDiscoveredPlugin(directManifest, dir, manifests);
        continue;
      }
      await this.scanDirectory(dir, manifests);
    }

    return manifests;
  }

  private addDiscoveredPlugin(
    manifest: PluginManifest,
    pluginPath: string,
    manifests: PluginManifest[]
  ): boolean {
    if (this.plugins.has(manifest.id)) {
      console.warn(
        `[PluginLoader] Plugin "${manifest.id}" already discovered, skipping duplicate at ${pluginPath}`
      );
      return false;
    }

    this.plugins.set(manifest.id, {
      manifest,
      path: pluginPath,
      isActive: false,
    });

    manifests.push(manifest);
    return true;
  }

  /**
   * Recursively scan a directory for plugins.
   * A directory with a manifest is treated as a plugin.
   * A directory without a manifest is treated as a category folder
   * and its subdirectories are scanned recursively.
   */
  private async scanDirectory(dir: string, manifests: PluginManifest[]): Promise<void> {
    if (!fs.existsSync(dir)) {
      return;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const pluginPath = path.join(dir, entry.name);
      const manifest = await this.loadManifest(pluginPath);

      if (manifest) {
        this.addDiscoveredPlugin(manifest, pluginPath, manifests);
      } else {
        // No manifest found — treat as category folder and recurse
        await this.scanDirectory(pluginPath, manifests);
      }
    }
  }

  /**
   * Load and validate a manifest from a plugin directory.
   */
  private async loadManifest(
    pluginPath: string,
    options: { warnMissing?: boolean } = {}
  ): Promise<PluginManifest | null> {
    // Try different manifest file names
    const manifestNames = ['plugin.json', 'manifest.json', 'package.json'];
    let manifestPath: string | null = null;

    for (const name of manifestNames) {
      const tryPath = path.join(pluginPath, name);
      if (fs.existsSync(tryPath)) {
        manifestPath = tryPath;
        break;
      }
    }

    if (!manifestPath) {
      if (options.warnMissing !== false) {
        console.warn(`[PluginLoader] No manifest found in ${pluginPath}`);
      }
      return null;
    }

    try {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      const rawManifest = JSON.parse(content);

      // Validate manifest
      const { valid, errors } = this.validateManifest(rawManifest);
      if (!valid) {
        console.error(`[PluginLoader] Invalid manifest in ${pluginPath}:`, errors);
        return null;
      }

      // For package.json, extract claudia field if present
      if (manifestPath.endsWith('package.json')) {
        const pkgManifest = rawManifest as Record<string, unknown>;
        if (pkgManifest.claudia) {
          return {
            ...pkgManifest.claudia,
            id: (pkgManifest.claudia as Record<string, unknown>).id || pkgManifest.name,
            name: (pkgManifest.claudia as Record<string, unknown>).name || pkgManifest.name,
            version:
              (pkgManifest.claudia as Record<string, unknown>).version || pkgManifest.version,
          } as PluginManifest;
        }
      }

      return rawManifest as PluginManifest;
    } catch (error) {
      console.error(
        `[PluginLoader] Error loading manifest from ${pluginPath}:`,
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  }

  /**
   * Validate a plugin manifest.
   */
  private validateManifest(manifest: unknown): PluginValidationResult {
    // Basic validation (full validation is in shared package)
    const errors: string[] = [];

    if (!manifest || typeof manifest !== 'object') {
      return { valid: false, errors: ['Manifest must be an object'], warnings: [] };
    }

    const m = manifest as Record<string, unknown>;

    if (!m.id || typeof m.id !== 'string') {
      errors.push('Missing required field: id');
    }

    if (!m.name || typeof m.name !== 'string') {
      errors.push('Missing required field: name');
    }

    if (!m.version || typeof m.version !== 'string') {
      errors.push('Missing required field: version');
    }

    if (!m.description || typeof m.description !== 'string') {
      errors.push('Missing required field: description');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: [],
    };
  }

  /**
   * Check plugin compatibility with the current app version.
   */
  checkCompatibility(manifest: PluginManifest): { compatible: boolean; error?: string } {
    return checkPluginCompatibility(manifest.engines);
  }

  /**
   * Resolve plugin dependencies.
   * Returns an array of missing dependency plugin IDs.
   */
  resolveDependencies(manifest: PluginManifest): string[] {
    const dependencies = manifest.dependencies;
    if (!dependencies || Object.keys(dependencies).length === 0) {
      return [];
    }

    const missing: string[] = [];

    for (const [depId, _version] of Object.entries(dependencies)) {
      const depPlugin = this.plugins.get(depId);
      if (!depPlugin) {
        missing.push(depId);
      } else if (!depPlugin.isActive) {
        // Dependency exists but is not active
        missing.push(depId);
      }
    }

    return missing;
  }

  /**
   * Activate a plugin by ID.
   */
  async activate(pluginId: string): Promise<boolean> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      console.error(`[PluginLoader] Plugin not found: ${pluginId}`);
      return false;
    }

    if (instance.isActive) {
      console.warn(`[PluginLoader] Plugin already active: ${pluginId}`);
      return true;
    }

    try {
      // Check compatibility
      const compatibility = this.checkCompatibility(instance.manifest);
      if (!compatibility.compatible) {
        console.error(
          `[PluginLoader] Plugin ${pluginId} compatibility check failed: ${compatibility.error}`
        );
        instance.error = compatibility.error;
        await pluginEvents.emit('plugin.error', { pluginId, error: instance.error }, pluginId);
        return false;
      }

      // Check dependencies
      const missingDeps = this.resolveDependencies(instance.manifest);
      if (missingDeps.length > 0) {
        console.error(
          `[PluginLoader] Plugin ${pluginId} has missing dependencies: ${missingDeps.join(', ')}`
        );
        instance.error = `Missing dependencies: ${missingDeps.join(', ')}`;
        await pluginEvents.emit('plugin.error', { pluginId, error: instance.error }, pluginId);
        return false;
      }

      // Capability negotiation: check `requires` in manifest
      if (instance.manifest.requires) {
        const capabilities = await this.negotiateCapabilities(pluginId, instance.manifest.requires);
        instance.capabilities = capabilities;
        if (!capabilities.satisfied) {
          const reasons = capabilities.unsatisfiedReasons.join('; ');
          console.error(`[PluginLoader] Plugin ${pluginId} unsatisfied requirements: ${reasons}`);
          instance.error = `Unsatisfied requirements: ${reasons}`;
          await pluginEvents.emit('plugin.error', { pluginId, error: instance.error }, pluginId);
          return false;
        }
        console.log(`[PluginLoader] Plugin ${pluginId} capability negotiation passed`);
      }

      // Note: Permission checks are deferred to tool/command invocation time.
      // Requesting permissions here would block activation if no UI is connected
      // (e.g. during server startup before any WebSocket client connects).
      // Permissions are enforced lazily via checkPermissions() when plugin
      // tools or commands are actually invoked.
      const requiredPermissions = instance.manifest.permissions || [];
      if (requiredPermissions.length > 0) {
        const hasAll = permissionManager.hasAllPermissions(
          pluginId,
          requiredPermissions as Permission[]
        );
        if (!hasAll) {
          console.log(
            `[PluginLoader] Plugin ${pluginId} needs permissions: ${requiredPermissions.join(', ')} (will request on use)`
          );
          instance.pendingPermissions = requiredPermissions as Permission[];
        }
      }

      // Load and register contributions as one activation unit. This also
      // prevents a failed plugin from leaving managed runtime metadata trusted
      // or selectable after the rest of activation has rolled back.
      try {
        await this.registerContributions(instance);
      } catch (contributionError) {
        this.unregisterContributions(pluginId);
        throw contributionError;
      }

      // Load main module if specified
      try {
        if (instance.manifest.main) {
          await this.loadModule(instance);
        }
      } catch (moduleError) {
        // Rollback: clean up registered contributions on module load failure
        this.unregisterContributions(pluginId);
        throw moduleError;
      }

      instance.isActive = true;
      console.log(`[PluginLoader] Activated plugin: ${pluginId}`);

      // Emit activation event AFTER isActive is set, so broadcastPluginState() sees correct state
      await pluginEvents.emit('plugin.activated', { pluginId }, pluginId);

      return true;
    } catch (error) {
      instance.error = error instanceof Error ? error.message : String(error);
      console.error(`[PluginLoader] Failed to activate plugin ${pluginId}:`, instance.error);
      await pluginEvents.emit('plugin.error', { pluginId, error: instance.error }, pluginId);
      return false;
    }
  }

  /**
   * Check and request pending permissions for a plugin.
   * Called lazily when a plugin's tool or command is first invoked.
   * Returns true if all permissions are granted, false if denied.
   */
  async checkPermissions(pluginId: string): Promise<boolean> {
    const instance = this.plugins.get(pluginId);
    if (!instance || !instance.pendingPermissions || instance.pendingPermissions.length === 0) {
      return true;
    }

    // Check if permissions were granted since activation
    const hasAll = permissionManager.hasAllPermissions(
      pluginId,
      instance.pendingPermissions as Permission[]
    );
    if (hasAll) {
      instance.pendingPermissions = undefined;
      return true;
    }

    // Non-blocking: don't wait for UI response.
    // Caller should inspect getPendingPermissions() and surface to the user.
    console.warn(
      `[PluginLoader] Plugin ${pluginId} has ungranted permissions: ${instance.pendingPermissions.join(', ')}`
    );
    return false;
  }

  /**
   * Get the pending (ungranted) permissions for a plugin, if any.
   */
  getPendingPermissions(pluginId: string): string[] | undefined {
    const instance = this.plugins.get(pluginId);
    return instance?.pendingPermissions as string[] | undefined;
  }

  /**
   * Negotiate capabilities declared in manifest.requires.
   * Returns a result indicating which requirements are satisfied.
   */
  private async negotiateCapabilities(
    pluginId: string,
    requires: NonNullable<PluginManifest['requires']>
  ): Promise<CapabilityNegotiationResult> {
    const result: CapabilityNegotiationResult = {
      satisfied: true,
      mcp: {},
      plugins: {},
      providers: { available: false },
      unsatisfiedReasons: [],
    };

    // 1. Check MCP server requirements
    if (requires.mcp) {
      for (const req of requires.mcp) {
        const status = await this.checkMcpRequirement(req);
        result.mcp[req.server] = status;

        const isRequired = req.required !== false; // default: true
        if (!status.available && isRequired) {
          result.satisfied = false;
          result.unsatisfiedReasons.push(
            status.error || `MCP server "${req.server}" not available`
          );
        }
        if (status.missingTools && status.missingTools.length > 0 && isRequired) {
          result.satisfied = false;
          result.unsatisfiedReasons.push(
            `MCP server "${req.server}" missing tools: ${status.missingTools.join(', ')}`
          );
        }
      }
    }

    // 2. Check plugin dependencies (beyond manifest.dependencies)
    if (requires.plugins) {
      for (const dep of requires.plugins) {
        const depPlugin = this.plugins.get(dep.id);
        const available = !!depPlugin?.isActive;
        result.plugins[dep.id] = { available };

        if (!available && dep.required !== false) {
          result.satisfied = false;
          result.unsatisfiedReasons.push(`Plugin "${dep.id}" not available`);
        }
      }
    }

    // 3. Check provider requirements
    if (requires.providers?.required) {
      const providerCountRow = this.db
        ? (this.db.prepare('SELECT COUNT(*) as count FROM providers').get() as
            | { count: number }
            | undefined)
        : undefined;
      const providerCount = providerCountRow?.count ?? 0;
      result.providers.available = providerCount > 0;
      if (!result.providers.available) {
        result.satisfied = false;
        result.unsatisfiedReasons.push('No AI providers available');
      }
    } else {
      result.providers.available = !!this.db;
    }

    return result;
  }

  /**
   * Check a single MCP server requirement against available MCP servers.
   */
  private async checkMcpRequirement(req: McpRequirement): Promise<McpCapabilityStatus> {
    if (!this.db) {
      return { server: req.server, available: false, error: 'Database not available' };
    }

    try {
      const config = loadMcpServersFromDb(this.db)[req.server];
      if (!config) {
        return {
          server: req.server,
          available: false,
          error: `MCP server "${req.server}" not configured`,
        };
      }

      // If no specific tools required, just check server exists + enabled
      if (!req.tools || req.tools.length === 0) {
        return { server: req.server, available: true };
      }

      // Check specific tools
      const tools = await mcpClientManager.listTools(req.server, config);
      const toolNames = new Set(tools.map((t: { name: string }) => t.name));

      const availableTools = req.tools.filter(t => toolNames.has(t));
      const missingTools = req.tools.filter(t => !toolNames.has(t));

      return {
        server: req.server,
        available: missingTools.length === 0,
        availableTools,
        missingTools: missingTools.length > 0 ? missingTools : undefined,
      };
    } catch (err) {
      return {
        server: req.server,
        available: false,
        error: `Failed to check MCP server "${req.server}": ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Deactivate a plugin by ID.
   */
  async deactivate(pluginId: string): Promise<boolean> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      console.error(`[PluginLoader] Plugin not found: ${pluginId}`);
      return false;
    }

    if (!instance.isActive) {
      return true;
    }

    try {
      // Stop Worker if running in worker mode
      if (workerHost.hasWorker(pluginId)) {
        await workerHost.stopPlugin(pluginId);
      } else if (hasDeactivate(instance.module)) {
        // Call deactivate if module exports it (main thread mode)
        await instance.module.deactivate();
      }

      // Unregister all contributions
      this.unregisterContributions(pluginId);

      // Resolve any permission dialog still waiting on this plugin as denied
      // (without persisting the denial) so open dialogs get retired.
      permissionManager.cancelPendingRequests(pluginId);

      instance.isActive = false;
      instance.module = undefined;

      // Emit deactivation event
      await pluginEvents.emit('plugin.deactivated', { pluginId }, pluginId);

      console.log(`[PluginLoader] Deactivated plugin: ${pluginId}`);
      return true;
    } catch (error) {
      console.error(
        `[PluginLoader] Error deactivating plugin ${pluginId}:`,
        error instanceof Error ? error.message : String(error)
      );
      return false;
    }
  }

  /**
   * Register plugin contributions.
   */
  private async registerContributions(instance: PluginInstance): Promise<void> {
    const { manifest } = instance;
    const contributes = manifest.contributes;
    if (!contributes) return;

    // Register commands (normalize: ensure / prefix)
    if (contributes.commands) {
      for (const cmd of contributes.commands) {
        const normalized = cmd.command.startsWith('/') ? cmd.command : `/${cmd.command}`;
        commandRegistry.register({
          command: normalized,
          description: cmd.title,
          handler: async (args, _context) => {
            // Default handler - plugins can override via registerCommand()
            return {
              type: 'builtin',
              command: normalized,
              data: { args, category: cmd.category },
            };
          },
          source: 'plugin',
          pluginId: manifest.id,
        });
      }
    }

    // Register tools
    if (contributes.tools) {
      for (const tool of contributes.tools) {
        toolRegistry.register({
          id: tool.id,
          definition: {
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          },
          handler: async args => {
            // Default handler - plugins can override via module
            return JSON.stringify({ message: 'Tool not implemented', args });
          },
          source: 'plugin',
          pluginId: manifest.id,
          permissions: tool.permissions,
        });
      }
    }

    // Register workflow steps
    if (contributes.workflowSteps) {
      for (const step of contributes.workflowSteps) {
        const fullType = `${manifest.id}/${step.id}`;
        workflowStepRegistry.register({
          type: fullType,
          name: step.name,
          description: step.description,
          category: step.category ?? 'Plugins',
          icon: step.icon,
          configSchema: step.configSchema,
          handler: async () => ({
            status: 'failed' as const,
            output: {},
            error: 'Step handler not implemented',
          }),
          pluginId: manifest.id,
        });
      }
      this.broadcastFn?.({ type: 'workflow_step_types_changed' });
    }

    // Register trigger sources
    if (contributes.triggerSources) {
      for (const src of contributes.triggerSources) {
        workflowTriggerRegistry.register({
          id: `${manifest.id}/${src.id}`,
          name: src.name,
          description: src.description,
          eventPattern: src.eventPattern,
          category: src.category ?? 'Plugins',
          icon: src.icon,
          source: manifest.id,
        });
      }
      this.broadcastFn?.({ type: 'workflow_trigger_sources_changed' });
    }

    // Register agentRuntimes descriptors BEFORE agentProfiles below: when a plugin
    // ships both, the runtime descriptor must exist before its bundled profile
    // installs and validates its runtimeType (see runtime-type-guard.ts).
    if (contributes.agentRuntimes) {
      await managedRuntimeService.registerPlugin({
        pluginId: manifest.id,
        pluginVersion: manifest.version,
        pluginPath: instance.path,
        publisher: manifest.author?.name,
        runtimes: contributes.agentRuntimes.map(runtime => runtime.type),
      });
      const n = registerAgentRuntimeContributions(manifest.id, contributes.agentRuntimes);
      if (n > 0) this.broadcastFn?.({ type: 'agent_runtimes_changed' });
    }

    if (contributes.agentProfiles) {
      if (this.db) {
        const service = new PluginAgentProfileService(this.db);
        const installed = service.installContributions(manifest.id, contributes.agentProfiles);
        if (installed > 0) {
          this.broadcastFn?.({ type: 'agent_profiles_changed' });
        }
      } else {
        console.warn(
          `[PluginLoader] Cannot install agentProfiles for plugin "${manifest.id}" without database`
        );
      }
    }

    // Collect plugin skill directories. Actual content loading happens via
    // skill-bootstrap.loadAndCachePluginSkills (which calls pi loadSourcedSkills)
    // and is wired up at server startup + on workspace HTTP refresh. No more
    // skill__<id> MCP tool registration — the model reads SKILL.md on demand
    // via the Read tool, surfaced through the <available_skills> XML block.
    if (contributes.skills) {
      const pluginInfo = this.plugins.get(manifest.id);
      if (pluginInfo) {
        const resolvedPluginDir = path.resolve(pluginInfo.path);
        for (const skill of contributes.skills) {
          const skillMdPath = path.resolve(pluginInfo.path, skill.path);
          // Validate path stays within plugin directory (prevent path traversal)
          if (
            !skillMdPath.startsWith(resolvedPluginDir + path.sep) &&
            skillMdPath !== resolvedPluginDir
          ) {
            console.warn(
              `[PluginLoader] Skill path escapes plugin directory: ${skill.path} in plugin "${manifest.id}"`
            );
            continue;
          }
          const skillDir = path.dirname(skillMdPath);
          this.pluginSkillDirs.push({ pluginId: manifest.id, path: skillDir, source: 'plugin' });
        }
      }
    }

    // Broadcast panel registrations to connected frontends
    if (contributes.panels) {
      for (const panel of contributes.panels) {
        const iframeUrl = panel.frontend
          ? `/api/plugins/${manifest.id}/frontend/${panel.frontend}`
          : undefined;
        this.broadcastFn?.({
          type: 'plugin_panel_registered',
          panelId: panel.id,
          pluginId: manifest.id,
          label: panel.label,
          icon: panel.icon,
          iframeUrl,
          order: panel.order,
        });
      }
    }
  }

  /**
   * Unregister all contributions for a plugin.
   */
  private unregisterContributions(pluginId: string): void {
    // Clear commands
    commandRegistry.clearByPlugin(pluginId);

    // Clear tools
    toolRegistry.clearByPlugin(pluginId);

    // Clear workflow steps
    if (workflowStepRegistry.getByPlugin(pluginId).length > 0) {
      workflowStepRegistry.clearByPlugin(pluginId);
      this.broadcastFn?.({ type: 'workflow_step_types_changed' });
    }

    // Clear trigger sources
    if (workflowTriggerRegistry.getByPlugin(pluginId).length > 0) {
      workflowTriggerRegistry.clearByPlugin(pluginId);
      this.broadcastFn?.({ type: 'workflow_trigger_sources_changed' });
    }

    // Clear event listeners
    pluginEvents.clearByPlugin(pluginId);

    // Clear scheduled tasks
    pluginScheduler.clearByPlugin(pluginId);

    // Drop plugin skill dirs collected during registerContributions. The
    // shared skill cache (skill-tools.cached) is NOT eagerly cleared here —
    // it's an in-memory snapshot that gets rebuilt on the next refresh /
    // server restart. A future enhancement could call refreshSkillCache
    // synchronously, but for now we accept the staleness window.
    this.pluginSkillDirs = this.pluginSkillDirs.filter(d => d.pluginId !== pluginId);

    // Notify frontend to unregister panels
    this.broadcastFn?.({ type: 'plugin_panel_unregistered', pluginId });

    // Clear agentRuntimes descriptors + any registered adapters for this plugin.
    managedRuntimeService.unregisterPlugin(pluginId);
    unregisterAgentRuntimeContributions(pluginId);
    providerRegistry.removePluginAdapters(pluginId);
    this.broadcastFn?.({ type: 'agent_runtimes_changed' });

    // Uninstall plugin-owned agent profiles.
    if (this.db) {
      const removed = new AgentProfileRepository(this.db).deleteByPlugin(pluginId);
      if (removed > 0) this.broadcastFn?.({ type: 'agent_profiles_changed' });
    }
  }

  /**
   * Remove a plugin completely (deactivate and clear permissions).
   */
  async remove(pluginId: string): Promise<boolean> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      return false;
    }

    // Deactivate first
    if (instance.isActive) {
      await this.deactivate(pluginId);
    }

    // Clear permissions
    permissionManager.clearPluginPermissions(pluginId);

    // Clear exported plugin APIs
    this.pluginAPIs.delete(pluginId);

    // Remove from plugins map
    this.plugins.delete(pluginId);

    return true;
  }

  /**
   * Reload a plugin: deactivate → clear module cache → re-read manifest → activate.
   * This enables hot-reload when plugin files on disk have been updated.
   */
  async reload(pluginId: string): Promise<boolean> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      console.error(`[PluginLoader] Plugin not found: ${pluginId}`);
      return false;
    }

    const pluginPath = instance.path;
    const wasActive = instance.isActive;
    console.log(`[PluginLoader] Reloading plugin: ${pluginId} from ${pluginPath}`);

    // 1. Deactivate (unregisters contributions, calls deactivate(), stops worker)
    if (wasActive) {
      await this.deactivate(pluginId);
    }

    // 2. Bust Node.js module cache for plugin files.
    //    ESM: import() caches by URL, so we append ?t=<timestamp> in loadModule.
    //    CJS: clear require.cache entries under the plugin directory.
    try {
      const { createRequire } = await import('module');
      const cjsRequire = createRequire(import.meta.url);
      for (const key of Object.keys(cjsRequire.cache)) {
        if (key.startsWith(pluginPath)) {
          delete cjsRequire.cache[key];
        }
      }
    } catch {
      // CJS cache not available — ESM cache busting via ?t= query is sufficient
    }

    // 3. Re-read manifest from disk (it may have changed)
    const manifest = await this.loadManifest(pluginPath);
    if (!manifest) {
      console.error(`[PluginLoader] Failed to load manifest after reload: ${pluginPath}`);
      return false;
    }

    // 4. Update the instance with fresh manifest
    this.plugins.set(pluginId, {
      manifest,
      path: pluginPath,
      isActive: false,
      error: undefined,
      module: undefined,
    });

    // 5. Re-activate if it was previously active
    if (wasActive) {
      return this.activate(pluginId);
    }

    console.log(`[PluginLoader] Plugin ${pluginId} reloaded (not re-activated — was inactive)`);
    return true;
  }

  /**
   * Load a plugin's main module.
   */
  private async loadModule(instance: PluginInstance): Promise<void> {
    const { manifest } = instance;
    if (!manifest.main) return;

    const modulePath = path.join(instance.path, manifest.main);

    if (!fs.existsSync(modulePath)) {
      throw new Error(`Module not found: ${modulePath}`);
    }

    // Worker isolation mode
    if (manifest.executionMode === 'worker') {
      if (!this.db) {
        throw new Error(`Worker plugin ${manifest.id} requires database context`);
      }
      workerHost.setDatabase(this.db);
      if (this.broadcastFn)
        workerHost.setBroadcast(msg => this.broadcastFn?.(msg as ServerMessage));
      await workerHost.startPlugin(manifest.id, modulePath);
      return;
    }

    try {
      // Dynamic import (main thread)
      // Append cache-busting query param so re-imports after reload get fresh code.
      // Node.js ESM loader caches by full URL including query string.
      const moduleUrl = `${modulePath}?t=${Date.now()}`;
      const module = (await import(moduleUrl)) as Partial<PluginModule>;
      instance.module = module;

      // Call activate if exported
      if (typeof module.activate === 'function') {
        const context = createPluginContext({
          pluginId: manifest.id,
          instance,
          db: this.db,
          broadcast: this.broadcastFn,
          pluginAPIs: this.pluginAPIs,
        }) as PluginContext;
        await module.activate(context);
      }
    } catch (error) {
      throw new Error(
        `Failed to load module: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Deactivate all plugins.
   */
  async deactivateAll(): Promise<void> {
    for (const [pluginId] of this.plugins) {
      await this.deactivate(pluginId);
    }
  }

  /**
   * Get the number of discovered plugins.
   */
  get size(): number {
    return this.plugins.size;
  }
}

// ============================================
// Singleton Export
// ============================================

export const pluginLoader = new PluginLoader();
