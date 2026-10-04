/**
 * Wire types for language-server status (server-side LanguageServerManager →
 * desktop Settings and the session composer indicator).
 */

/**
 * `idle`: detected but not running (starts on first use). `stopped`: crashed
 * and waiting out its restart backoff. `failed`: will not start again until
 * the server restarts or the setting is toggled. `missing`: the workspace
 * needs it (root markers present) but it is not installed.
 * `needs_permission`: a plugin's server whose plugin may not run commands
 * (`shell.execute`) yet.
 */
export type LanguageServerState =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'stopped'
  | 'failed'
  | 'missing'
  | 'needs_permission';

/** Where a server definition comes from; on the same id, user > plugin > built in. */
export type LanguageServerSource = 'builtin' | 'plugin' | 'user';

export interface LanguageServerStatusEntry {
  id: string;
  name: string;
  languages: string[];
  /** Workspace root this server instance serves. */
  root: string;
  state: LanguageServerState;
  /** Consumers keeping it alive (e.g. running agent runs). */
  leases: number;
  openDocuments: number;
  pid: number | null;
  startedAt: number | null;
  lastUsedAt: number | null;
  lastError: string | null;
  /** Command that installs the server, when it is missing or failed to start. */
  installHint: string | null;
  source: LanguageServerSource;
  /** The contributing plugin, for `source: 'plugin'`. */
  pluginId: string | null;
}

/** GET /api/language-servers — every server instance on this backend. */
export interface LanguageServersOverview {
  enabled: boolean;
  servers: LanguageServerStatusEntry[];
}

/** GET /api/language-servers/sessions/:sessionId — what one session's agent can use. */
export interface SessionLanguageServers {
  /** False for runtimes that do not use zclaudia's language servers (external CLIs). */
  applicable: boolean;
  enabled: boolean;
  root: string | null;
  /** Servers detected for the session's workspace, running or not. */
  servers: LanguageServerStatusEntry[];
}

/**
 * A language server defined by the user (Settings) or a plugin
 * (`contributes.lspServers`). It is used in workspaces that contain one of
 * its root markers, for files with one of its extensions.
 */
export interface LanguageServerConfig {
  /** Slug; a definition with the id of a built-in server replaces it. */
  id: string;
  name: string;
  /**
   * Executable: an absolute path, a name looked up on PATH, or (plugins
   * only) a path inside the plugin starting with `./`.
   */
  command: string;
  args?: string[];
  /** Extension (with the dot) → LSP language id, e.g. { ".c": "c" }. */
  extensions: Record<string, string>;
  /** Files whose presence marks a workspace for this server. */
  rootMarkers: string[];
  initializationOptions?: unknown;
  /** Answers to the server's workspace/configuration requests, by section. */
  settings?: Record<string, unknown>;
}

/** GET/PUT /api/language-servers/custom */
export interface CustomLanguageServers {
  servers: LanguageServerConfig[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const EXTENSION_PATTERN = /^\.[A-Za-z0-9_+-]{1,32}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate one definition. `allowRelativeCommand` lets a plugin point at a
 * file it ships (`./bin/server`); user definitions cannot.
 */
export function validateLanguageServerConfig(
  value: unknown,
  options: { allowRelativeCommand?: boolean } = {}
): { ok: true; config: LanguageServerConfig } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['must be an object'] };
  const { id, name, command, args, extensions, rootMarkers, initializationOptions, settings } =
    value;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    errors.push('id must be a lowercase slug (letters, digits, ".", "_", "-")');
  }
  if (typeof name !== 'string' || !name.trim()) errors.push('name is required');
  if (typeof command !== 'string' || !command.trim()) {
    errors.push('command is required');
  } else if (/^\.\.?[\\/]/.test(command.trim()) && !options.allowRelativeCommand) {
    errors.push('command must be an absolute path or a name on PATH');
  }
  if (args !== undefined && (!Array.isArray(args) || args.some(arg => typeof arg !== 'string'))) {
    errors.push('args must be a list of strings');
  }
  if (!isRecord(extensions) || Object.keys(extensions).length === 0) {
    errors.push('extensions must map at least one extension to a language id');
  } else {
    for (const [extension, languageId] of Object.entries(extensions)) {
      if (!EXTENSION_PATTERN.test(extension)) {
        errors.push(`extension "${extension}" must start with a dot, e.g. ".c"`);
      }
      if (typeof languageId !== 'string' || !languageId.trim()) {
        errors.push(`extension "${extension}" needs a language id`);
      }
    }
  }
  if (
    !Array.isArray(rootMarkers) ||
    rootMarkers.length === 0 ||
    rootMarkers.some(marker => typeof marker !== 'string' || !marker.trim())
  ) {
    errors.push('rootMarkers must list at least one file name, e.g. "compile_commands.json"');
  }
  if (settings !== undefined && !isRecord(settings)) errors.push('settings must be an object');
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    config: {
      id: id as string,
      name: (name as string).trim(),
      command: (command as string).trim(),
      ...(args ? { args: args as string[] } : {}),
      extensions: Object.fromEntries(
        Object.entries(extensions as Record<string, string>).map(([ext, lang]) => [
          ext.toLowerCase(),
          lang.trim(),
        ])
      ),
      rootMarkers: (rootMarkers as string[]).map(marker => marker.trim()),
      ...(initializationOptions !== undefined ? { initializationOptions } : {}),
      ...(settings ? { settings: settings as Record<string, unknown> } : {}),
    },
  };
}

/** Validate a list; ids must be unique within it. */
export function validateLanguageServerConfigs(
  value: unknown,
  options: { allowRelativeCommand?: boolean; label?: string } = {}
): { ok: true; configs: LanguageServerConfig[] } | { ok: false; errors: string[] } {
  const label = options.label ?? 'servers';
  if (!Array.isArray(value)) return { ok: false, errors: [`${label} must be an array`] };
  const errors: string[] = [];
  const configs: LanguageServerConfig[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const result = validateLanguageServerConfig(entry, options);
    if (!result.ok) {
      errors.push(...result.errors.map(error => `${label}[${index}]: ${error}`));
      return;
    }
    if (seen.has(result.config.id)) {
      errors.push(`${label}[${index}]: duplicate id "${result.config.id}"`);
      return;
    }
    seen.add(result.config.id);
    configs.push(result.config);
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, configs };
}
