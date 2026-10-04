/**
 * Wire types for language-server status (server-side LanguageServerManager →
 * desktop Settings and the session composer indicator).
 */

/**
 * `idle`: detected but not running (starts on first use). `stopped`: crashed
 * and waiting out its restart backoff. `failed`: will not start again until
 * the server restarts or the setting is toggled.
 */
export type LanguageServerState = 'idle' | 'starting' | 'ready' | 'stopped' | 'failed';

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
