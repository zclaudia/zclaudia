/**
 * Plugin `contributes.lspServers`: language servers a plugin adds to the
 * shared registry (built in < plugin < user).
 *
 * Starting one runs the plugin's command, so each is gated on the plugin
 * holding `shell.execute`. The gate is checked whenever a server would start,
 * and a grant or revocation re-evaluates the registry, which stops running
 * servers whose plugin lost the permission.
 */
import { validateLanguageServerConfigs } from '@zclaudia/shared/core/language-servers';
import { pluginEvents } from '../../infra/events/index.js';
import {
  createConfiguredPreset,
  languageServerRegistry,
  type LanguageServerRegistry,
} from '../../infra/lsp/index.js';
import { permissionManager } from './permissions.js';

export interface LanguageServerContributionOptions {
  pluginId: string;
  /** Plugin directory; `./` commands resolve inside it. */
  pluginPath: string;
  /** Granted by the host for a verified built-in plugin. */
  builtinShellExecute?: boolean;
  registry?: LanguageServerRegistry;
  hasPermission?: (pluginId: string) => boolean;
}

/**
 * Register a plugin's servers. Returns the unregister function, or an error
 * list when the declarations are invalid (nothing is registered then).
 */
export function registerLanguageServerContributions(
  declared: unknown,
  options: LanguageServerContributionOptions
): { ok: true; unregister: () => void } | { ok: false; errors: string[] } {
  const result = validateLanguageServerConfigs(declared, {
    allowRelativeCommand: true,
    label: 'contributes.lspServers',
  });
  if (!result.ok) return result;
  const { pluginId } = options;
  const registry = options.registry ?? languageServerRegistry;
  const hasPermission =
    options.hasPermission ?? (id => permissionManager.hasPermission(id, 'shell.execute'));
  const permission = {
    pluginId,
    granted: () => options.builtinShellExecute === true || hasPermission(pluginId),
  };
  registry.setPluginPresets(
    pluginId,
    result.configs.map(config =>
      createConfiguredPreset(config, { baseDir: options.pluginPath, permission })
    )
  );
  const unsubscribers = ['permission.granted', 'permission.revoked', 'permission.cleared'].map(
    event =>
      pluginEvents.on(event, data => {
        if (data.pluginId === pluginId) registry.notifyChanged();
      })
  );
  return {
    ok: true,
    unregister: () => {
      unsubscribers.forEach(off => off());
      registry.removePlugin(pluginId);
    },
  };
}
