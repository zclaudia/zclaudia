import type { Permission } from '@zclaudia/shared/plugin-types';
import { pluginLoader, PluginRuntimeBusyError } from './loader.js';
import { permissionManager } from './permissions.js';
import { toolRegistry } from './tool-registry.js';
import { commandRegistry } from '../commands/registry.js';
import { pluginPackageService, type PluginPackageService } from './package-service.js';

interface PluginManifestSummary {
  id: string;
  name: string;
  version: string;
}

interface PluginManagementDependencies {
  loader?: typeof pluginLoader;
  permissions?: typeof permissionManager;
  tools?: typeof toolRegistry;
  commands?: typeof commandRegistry;
  packages?: PluginPackageService;
}

export class PluginManagementError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export class PluginManagementService {
  private readonly loader: typeof pluginLoader;
  private readonly permissions: typeof permissionManager;
  private readonly tools: typeof toolRegistry;
  private readonly commands: typeof commandRegistry;
  private readonly packages: PluginPackageService;

  constructor(deps: PluginManagementDependencies = {}) {
    this.loader = deps.loader ?? pluginLoader;
    this.permissions = deps.permissions ?? permissionManager;
    this.tools = deps.tools ?? toolRegistry;
    this.commands = deps.commands ?? commandRegistry;
    this.packages = deps.packages ?? pluginPackageService;
  }

  listPlugins() {
    return this.loader.getPlugins().map(plugin => {
      const contributes = plugin.manifest.contributes || {};
      const packageInfo = this.packages.describePlugin(plugin.manifest, plugin.path);
      const panels = (contributes.panels || []).map(
        (panel: {
          id: string;
          label: string;
          icon?: string;
          order?: number;
          frontend?: string;
        }) => ({
          id: panel.id,
          label: panel.label,
          icon: panel.icon,
          order: panel.order,
          iframeUrl: panel.frontend
            ? `/api/plugins/${plugin.manifest.id}/frontend/${panel.frontend}`
            : undefined,
        })
      );
      return {
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        description: plugin.manifest.description,
        author: plugin.manifest.author,
        platform: plugin.manifest.platform,
        status: plugin.isActive ? 'active' : plugin.error ? 'error' : 'inactive',
        enabled: plugin.isActive,
        error: plugin.error,
        permissions: plugin.manifest.permissions || [],
        grantedPermissions: this.permissions.getGrantedPermissions(plugin.manifest.id),
        pendingPermissions: plugin.pendingPermissions || [],
        tools: this.tools
          .getByPlugin(plugin.manifest.id)
          .map(tool => tool.definition.function.name),
        commands: this.commands.getByPlugin(plugin.manifest.id).map(command => command.command),
        path: plugin.path,
        panels,
        ...packageInfo,
        ...(this.loader.isBuiltin?.(plugin.manifest.id)
          ? {
              source: 'builtin' as const,
              enabled: this.loader.isBuiltinEnabled(plugin.manifest.id),
              canRollback: false,
              availableVersions: [],
              shadowedPaths: this.loader.getShadowedPaths(plugin.manifest.id),
            }
          : {}),
      };
    });
  }

  async activatePlugin(id: string): Promise<{ activated: true }> {
    this.assertPluginExists(id);
    const result = await this.loader.activate(id);
    if (!result) {
      const plugin = this.loader.getPlugin(id);
      throw new PluginManagementError(
        400,
        'ACTIVATION_FAILED',
        plugin?.error || 'Activation failed'
      );
    }
    this.loader.setBuiltinEnabled?.(id, true);
    return { activated: true };
  }

  async deactivatePlugin(id: string): Promise<{ deactivated: true }> {
    this.assertPluginExists(id);
    this.assertNotBusy(id);
    if (!(await this.runLifecycle(() => this.loader.deactivate(id)))) {
      throw new PluginManagementError(400, 'DEACTIVATION_FAILED', 'Failed to stop plugin');
    }
    this.loader.setBuiltinEnabled?.(id, false);
    return { deactivated: true };
  }

  async reloadPlugin(id: string): Promise<{ reloaded: true }> {
    this.assertPluginExists(id);
    this.assertNotBusy(id);
    const result = await this.runLifecycle(() => this.loader.reload(id));
    if (!result) {
      const plugin = this.loader.getPlugin(id);
      throw new PluginManagementError(400, 'RELOAD_FAILED', plugin?.error || 'Reload failed');
    }
    return { reloaded: true };
  }

  grantPermissions(id: string, permissions: unknown): { granted: Permission[] } {
    const validated = this.validatePermissions(permissions);
    this.permissions.grantAll(id, validated);
    return { granted: validated };
  }

  revokePermissions(id: string, permissions: unknown): { revoked: Permission[] } {
    const validated = this.validatePermissions(permissions);
    for (const permission of validated) {
      this.permissions.revoke(id, permission);
    }
    return { revoked: validated };
  }

  getPluginDirs(): { dirs: string[]; extraDirs: string[] } {
    return {
      dirs: this.loader.getPluginDirs(),
      extraDirs: this.loader.getExtraDirsFromDb(),
    };
  }

  updatePluginDirs(dirs: unknown): { dirs: string[] } {
    if (!Array.isArray(dirs) || !dirs.every(dir => typeof dir === 'string')) {
      throw new PluginManagementError(400, 'INVALID_INPUT', 'dirs must be an array of strings');
    }

    const normalized = [...new Set(dirs.map(dir => dir.trim()).filter(Boolean))];
    this.loader.saveExtraDirs(normalized);
    this.autoActivateDiscoveredPlugins().catch(() => {});

    return { dirs: this.loader.getPluginDirs() };
  }

  async discoverPlugins(): Promise<{ discovered: number; plugins: PluginManifestSummary[] }> {
    const manifests = await this.autoActivateDiscoveredPlugins();
    return {
      discovered: manifests.length,
      plugins: manifests.map(manifest => ({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
      })),
    };
  }

  async removePlugin(id: string): Promise<{ removed: true }> {
    this.assertPluginExists(id);
    this.assertMutable(id);
    this.assertNotBusy(id);
    const plugin = this.loader.getPlugin(id);
    if (!plugin) {
      throw new PluginManagementError(404, 'NOT_FOUND', `Plugin not found: ${id}`);
    }
    const packageInfo = this.packages.describePlugin(plugin.manifest, plugin.path);
    if (packageInfo.source === 'managed') {
      await this.packages.uninstallPlugin(id);
    } else {
      await this.loader.remove(id);
    }
    return { removed: true };
  }

  async rollbackPlugin(id: string, version?: unknown) {
    this.assertPluginExists(id);
    this.assertMutable(id);
    this.assertNotBusy(id);
    if (version !== undefined && typeof version !== 'string') {
      throw new PluginManagementError(400, 'INVALID_INPUT', 'version must be a string');
    }
    return await this.packages.rollbackPlugin(id, version);
  }

  private async autoActivateDiscoveredPlugins() {
    const manifests = await this.loader.discover();
    for (const manifest of manifests) {
      const plugin = this.loader.getPlugin(manifest.id);
      if (this.loader.isBuiltin?.(manifest.id) && !this.loader.isBuiltinEnabled(manifest.id))
        continue;
      if (plugin && !plugin.isActive) {
        this.loader.activate(manifest.id).catch(() => {});
      }
    }
    return manifests;
  }

  private assertPluginExists(id: string): void {
    if (!this.loader.hasPlugin(id)) {
      throw new PluginManagementError(404, 'NOT_FOUND', `Plugin not found: ${id}`);
    }
  }

  private assertMutable(id: string): void {
    if (this.loader.isBuiltin?.(id)) {
      throw new PluginManagementError(
        409,
        'BUILTIN_PLUGIN',
        'Built-in plugins are updated with the application'
      );
    }
  }

  private async runLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof PluginRuntimeBusyError)
        throw new PluginManagementError(409, 'RUNTIME_BUSY', error.message);
      throw error;
    }
  }

  private assertNotBusy(id: string): void {
    if (this.loader.isBusy?.(id)) {
      throw new PluginManagementError(
        409,
        'RUNTIME_BUSY',
        'Stop active runs before changing this runtime'
      );
    }
  }

  private validatePermissions(permissions: unknown): Permission[] {
    if (!Array.isArray(permissions)) {
      throw new PluginManagementError(400, 'VALIDATION_ERROR', 'permissions array required');
    }
    return permissions as Permission[];
  }
}
