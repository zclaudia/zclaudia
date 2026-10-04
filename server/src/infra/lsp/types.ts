/**
 * Shared types for the language-server manager.
 *
 * The manager is consumer-neutral by design (docs/plans/2026-10-04-lsp-manager-plan.md):
 * nothing here knows about runs, sessions or tool calls. Clients are keyed by
 * (preset id, workspace root) and kept alive by opaque leases.
 */
import type {
  LanguageServerInfo,
  LanguageServerPort,
  LspDiagnostic,
} from '../providers/language-server-port.js';

export type { LanguageServerInfo, LspDiagnostic };

/** How to launch one server process for one workspace root. */
export interface LaunchSpec {
  command: string;
  args: string[];
  cwd: string;
  initializationOptions?: unknown;
}

/**
 * A language-server definition. The data fields mirror a future plugin
 * `contributes.lspServers` entry; `resolveLaunch` is the bridge from that data
 * to a concrete command (a plugin entry would derive it from command/args).
 */
export interface LanguageServerPreset {
  id: string;
  name: string;
  /** LSP language ids, for display. */
  languages: string[];
  /** Lower-case extension (with dot) → LSP language id sent on didOpen. */
  extensions: Record<string, string>;
  /** Files whose presence in the workspace root enables this server. */
  rootMarkers: string[];
  /**
   * Resolve the launch for `root`, or null when the server is not usable there
   * (missing marker, missing executable). Must be sync and cheap — it is called
   * while building a run's tool list — so implementations cache their probes.
   */
  resolveLaunch(root: string): LaunchSpec | null;
}

/** A spawned server process as the client sees it. */
export interface LanguageServerTransport {
  reader: NodeJS.ReadableStream;
  writer: NodeJS.WritableStream;
  /** Settles when the process exits or its streams close. */
  exited: Promise<{ code: number | null; signal: string | null }>;
  kill(): void;
  pid?: number | null;
  /** ProcessSupervisor id, when supervised. */
  processId?: string;
  /** Last stderr output, for error reporting. */
  stderrTail(): string;
}

export type SpawnLanguageServer = (
  launch: LaunchSpec,
  meta: { presetId: string; root: string }
) => Promise<LanguageServerTransport>;

export type DiagnosticsCheck =
  | {
      state: 'ready';
      server: LanguageServerInfo;
      diagnostics: LspDiagnostic[];
      /**
       * Diagnostics of the file before the change, when known. Undefined means
       * there is no baseline, so pre-existing problems cannot be told apart.
       */
      baseline?: LspDiagnostic[];
    }
  | { state: 'pending'; server: LanguageServerInfo; reason: 'starting' | 'timeout' }
  | { state: 'unavailable'; reason: string };

export interface DiagnosticsRequest {
  /** Total wait for fresh diagnostics after syncing the file. */
  budgetMs: number;
  /**
   * File content before the change. `null` = the file was just created (empty
   * baseline). Undefined = unknown. Only used when the server has not seen the
   * file yet, to diagnose the old content first.
   */
  baselineContent?: string | null;
  signal?: AbortSignal;
}

export type LanguageServerState = 'idle' | 'starting' | 'ready' | 'stopped' | 'failed';

export interface LanguageServerStatus {
  id: string;
  name: string;
  root: string;
  state: LanguageServerState;
  leases: string[];
  openDocuments: number;
  pid: number | null;
  processId: string | null;
  startedAt: number | null;
  lastUsedAt: number | null;
  lastError: string | null;
}

/**
 * The manager's public surface; consumers depend on this, not the class. It is
 * also the LSPTool's `LanguageServerPort` (`serversFor` + `query`).
 */
export interface LanguageServerService extends LanguageServerPort {
  serversFor(root: string): LanguageServerInfo[];
  acquire(root: string, consumer: string): { release(): void };
  diagnosticsFor(
    root: string,
    file: string,
    request: DiagnosticsRequest
  ): Promise<DiagnosticsCheck>;
  status(): LanguageServerStatus[];
  dispose(): Promise<void>;
}
