/**
 * Language-server port: the contract a future in-process LSP manager fulfils
 * for the built-in LSPTool.
 *
 * Design (2026-09-23, see docs/plans/2026-09-23-tool-set-alignment-plan.md
 * Task 9): the tool surface stays a built-in so it keeps read-only permission
 * classification, shared scheduling and a stable model-facing name; the
 * *servers* are meant to be declared by plugins (ZCode-style `lspServers`
 * manifest entries) and driven by one server-side manager that owns the
 * processes, document sync and diagnostics. Until that manager exists no port
 * is wired, and `buildTools` does not register LSPTool at all — the model never
 * sees a tool that cannot answer.
 *
 * Contract notes for implementers:
 * - `serversFor` must be cheap and side-effect free: it is called once per run
 *   while building the tool list and must not start processes. Match on the
 *   workspace root (root markers / project languages), not on readiness.
 * - `query` may start a server lazily. Reject with `LanguageServerError` for
 *   expected failures so the tool can return a structured error.
 * - Positions are 1-based lines and columns on both sides of this port (what
 *   the model sees in Read output); the manager converts to 0-based LSP.
 * - Keying: worktree-isolated sub-agents run with a different cwd than the
 *   parent session, so a manager must key its clients by the actual cwd.
 */

export interface LanguageServerInfo {
  /** Stable identifier, e.g. `typescript-language-server`. */
  id: string;
  /** Human-readable name shown to the model, e.g. `TypeScript`. */
  name: string;
  /** LSP language ids this server handles, e.g. `['typescript', 'javascript']`. */
  languages: string[];
}

export type LspQueryAction =
  | 'definition'
  | 'references'
  | 'hover'
  | 'documentSymbols'
  | 'workspaceSymbols'
  | 'diagnostics';

export interface LspQueryRequest {
  cwd: string;
  action: LspQueryAction;
  /** Absolute path inside `cwd`. Required for every action except `workspaceSymbols`. */
  file?: string;
  /** 1-based line. Required for `definition`, `references`, `hover`. */
  line?: number;
  /** 1-based column. Required for `definition`, `references`, `hover`. */
  character?: number;
  /** Symbol query for `workspaceSymbols`. */
  query?: string;
  maxResults?: number;
}

export interface LspLocation {
  /** Workspace-relative path. */
  file: string;
  line: number;
  character: number;
  endLine?: number;
  endCharacter?: number;
  preview?: string;
}

export interface LspSymbol {
  name: string;
  kind: string;
  location: LspLocation;
  containerName?: string;
  children?: LspSymbol[];
}

export interface LspDiagnostic {
  file: string;
  line: number;
  character: number;
  severity: 'error' | 'warning' | 'information' | 'hint';
  message: string;
  source?: string;
  code?: string | number;
}

export type LspQueryResult =
  | { action: 'definition' | 'references'; locations: LspLocation[]; truncated?: boolean }
  | { action: 'hover'; contents: string | null }
  | {
      action: 'documentSymbols' | 'workspaceSymbols';
      symbols: LspSymbol[];
      truncated?: boolean;
    }
  | { action: 'diagnostics'; diagnostics: LspDiagnostic[]; truncated?: boolean };

export type LanguageServerErrorCode =
  | 'server_unavailable'
  | 'server_failed'
  | 'unsupported_action'
  | 'unsupported_language'
  | 'timeout';

export class LanguageServerError extends Error {
  constructor(
    readonly code: LanguageServerErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'LanguageServerError';
  }
}

export interface LanguageServerPort {
  /**
   * Servers configured for a workspace root. Sync, cheap, no side effects;
   * an empty array means LSPTool is not registered for that run.
   */
  serversFor(cwd: string): LanguageServerInfo[];
  /** Run one query; may lazily start the matching server. */
  query(request: LspQueryRequest, signal?: AbortSignal): Promise<LspQueryResult>;
}

/** True when `port` has at least one server for `cwd`; never throws. */
export function hasLanguageServers(port: LanguageServerPort | undefined, cwd: string): boolean {
  if (!port) return false;
  try {
    return port.serversFor(cwd).length > 0;
  } catch {
    return false;
  }
}
