import type { Permission } from './permissions.js';
import type { PluginContributes } from './contributions.js';
import type { PluginRequirements } from './capabilities.js';
import { validateEngineModeDeclarations } from '@zclaudia/plugin-sdk/providers';

export interface PluginAuthor {
  name: string;
  email?: string;
  url?: string;
}

export interface PluginEngines {
  claudia: string; // semver range, e.g., ">=0.1.0"
}

export type ExecutionMode = 'main' | 'worker' | 'sandbox';

/**
 * Plugin platform scope.
 * - 'universal': Works everywhere (pure backend — tools, commands, events, workflow steps)
 * - 'desktop': Requires desktop UI (has panels, toolbars, or other UI extensions)
 */
export type PluginPlatform = 'universal' | 'desktop';

export interface PluginManifest {
  id: string; // e.g., 'com.example.my-plugin'
  name: string;
  version: string;
  description: string;
  author?: PluginAuthor;
  icon?: string;

  main?: string; // Backend entry (server-side)
  frontend?: string; // Frontend entry (UI extensions)

  permissions?: Permission[];

  contributes?: PluginContributes;

  // Platform scope — inferred from contributions when omitted
  platform?: PluginPlatform;

  // Execution mode
  executionMode?: ExecutionMode;

  // Activation events
  activationEvents?: string[];

  // Compatibility declaration
  engines?: PluginEngines;

  // Plugin dependencies
  dependencies?: Record<string, string>; // pluginId → semver range

  // External capability requirements
  requires?: PluginRequirements;
}

export interface PluginValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Validate runtime declarations before discovery or package inspection uses them. */
export function validateAgentRuntimeContributions(contributes: unknown): string[] {
  if (contributes === undefined) return [];
  if (!isRecord(contributes)) return ['contributes must be an object'];
  const runtimes = contributes.agentRuntimes;
  if (runtimes === undefined) return [];
  if (!Array.isArray(runtimes)) return ['contributes.agentRuntimes must be an array'];
  return runtimes.flatMap((runtime, index) => {
    if (!isRecord(runtime) || typeof runtime.type !== 'string' || !runtime.type.trim()) {
      return [`contributes.agentRuntimes[${index}] must have a non-empty string type`];
    }
    // Dual-mode declarations: same structural contract the plugin SDK enforces.
    return validateEngineModeDeclarations(runtime).map(error => `contributes.agentRuntimes[${index}]: ${error}`);
  });
}

export function validatePluginManifest(manifest: unknown): PluginValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['Manifest must be an object'], warnings: [] };
  }

  const m = manifest as Record<string, unknown>;
  errors.push(...validateAgentRuntimeContributions(m.contributes));

  if (!m.id || typeof m.id !== 'string') {
    errors.push('Missing required field: id');
  } else if (!/^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*$/.test(m.id as string)) {
    errors.push('Invalid id format (use reverse domain notation, e.g., com.example.plugin)');
  }

  if (!m.name || typeof m.name !== 'string') {
    errors.push('Missing required field: name');
  }

  if (!m.version || typeof m.version !== 'string') {
    errors.push('Missing required field: version');
  } else if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(m.version as string)) {
    warnings.push('Version should follow semver format (e.g., 1.0.0)');
  }

  if (!m.description || typeof m.description !== 'string') {
    errors.push('Missing required field: description');
  }

  if (m.engines && typeof m.engines === 'object') {
    const engines = m.engines as Record<string, unknown>;
    if (!engines.claudia || typeof engines.claudia !== 'string') {
      warnings.push('engines.claudia should specify a semver range');
    }
  }

  if (m.contributes && typeof m.contributes === 'object') {
    const contributes = m.contributes as Record<string, unknown>;

    if (contributes.commands && Array.isArray(contributes.commands)) {
      for (const cmd of contributes.commands) {
        if (!isRecord(cmd) || !cmd.command || typeof cmd.command !== 'string') {
          errors.push('Command contribution missing "command" field');
        }
        if (!isRecord(cmd) || !cmd.title || typeof cmd.title !== 'string') {
          errors.push('Command contribution missing "title" field');
        }
      }
    }

    if (contributes.tools && Array.isArray(contributes.tools)) {
      for (const tool of contributes.tools) {
        if (!isRecord(tool) || !tool.id || typeof tool.id !== 'string') {
          errors.push('Tool contribution missing "id" field');
        }
        if (!isRecord(tool) || !tool.name || typeof tool.name !== 'string') {
          errors.push('Tool contribution missing "name" field');
        }
        if (!isRecord(tool) || !tool.description || typeof tool.description !== 'string') {
          errors.push('Tool contribution missing "description" field');
        }
      }
    }

    if (contributes.notchTabs && Array.isArray(contributes.notchTabs)) {
      for (const tab of contributes.notchTabs) {
        if (!isRecord(tab) || !tab.id || typeof tab.id !== 'string') {
          errors.push('NotchTab contribution missing "id" field');
        }
        if (!isRecord(tab) || !tab.label || typeof tab.label !== 'string') {
          errors.push('NotchTab contribution missing "label" field');
        }
      }
    }

    if (contributes.workflowSteps && Array.isArray(contributes.workflowSteps)) {
      for (const step of contributes.workflowSteps) {
        if (!isRecord(step) || !step.id || typeof step.id !== 'string') {
          errors.push('WorkflowStep contribution missing "id" field');
        }
        if (!isRecord(step) || !step.name || typeof step.name !== 'string') {
          errors.push('WorkflowStep contribution missing "name" field');
        }
        if (!isRecord(step) || !step.description || typeof step.description !== 'string') {
          errors.push('WorkflowStep contribution missing "description" field');
        }
      }
    }

    if (contributes.agentProfiles && Array.isArray(contributes.agentProfiles)) {
      for (const profile of contributes.agentProfiles) {
        if (!isRecord(profile) || !profile.id || typeof profile.id !== 'string') {
          errors.push('AgentProfile contribution missing "id" field');
        }
        if (!isRecord(profile) || !profile.name || typeof profile.name !== 'string') {
          errors.push('AgentProfile contribution missing "name" field');
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Resolve the effective platform for a plugin.
 * If manifest.platform is set, use it. Otherwise infer from contributes:
 *   - Has panels, uiExtensions, menus, or keybindings → 'desktop'
 *   - Otherwise → 'universal'
 */
export function resolvePluginPlatform(manifest: PluginManifest): PluginPlatform {
  if (manifest.platform) return manifest.platform;
  if (manifest.frontend) return 'desktop';

  const c = manifest.contributes;
  if (!c) return 'universal';

  const hasUI =
    (c.panels && c.panels.length > 0) ||
    (c.uiExtensions && c.uiExtensions.length > 0) ||
    (c.menus && c.menus.length > 0) ||
    (c.keybindings && c.keybindings.length > 0) ||
    (c.notchTabs && c.notchTabs.length > 0);

  return hasUI ? 'desktop' : 'universal';
}
