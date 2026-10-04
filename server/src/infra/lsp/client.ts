/**
 * LspClient — one JSON-RPC connection to one server process.
 *
 * Owns the handshake (initialize / initialized), answers the requests servers
 * send back to clients, and the orderly shutdown / exit sequence. Document
 * sync and diagnostics live in their own stores on top of `notify` and
 * `onNotification`.
 */
import { pathToFileURL } from 'url';
import path from 'path';
import {
  CancellationTokenSource,
  StreamMessageReader,
  StreamMessageWriter,
  createProtocolConnection,
  type InitializeParams,
  type InitializeResult,
  type ProtocolConnection,
  type ServerCapabilities,
} from 'vscode-languageserver-protocol/node';
import type { LanguageServerTransport } from './types.js';

const DEFAULT_INITIALIZE_TIMEOUT_MS = 60_000;
const DEFAULT_STOP_TIMEOUT_MS = 2_000;
const ACKNOWLEDGED_REQUESTS = [
  'client/registerCapability',
  'client/unregisterCapability',
  'window/workDoneProgress/create',
  'window/showMessageRequest',
  'workspace/codeLens/refresh',
  'workspace/semanticTokens/refresh',
  'workspace/inlayHint/refresh',
  'workspace/diagnostic/refresh',
];

/** The server process exited before answering `initialize`. */
export class LanguageServerStartupError extends Error {
  readonly name = 'LanguageServerStartupError';
}

export interface LspClientOptions {
  root: string;
  initializationOptions?: unknown;
  /** Answers to `workspace/configuration`, by section. */
  settings?: Record<string, unknown>;
  initializeTimeoutMs?: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function initializeParams(root: string, initializationOptions: unknown): InitializeParams {
  const rootUri = pathToFileURL(path.resolve(root)).href;
  return {
    processId: process.pid,
    clientInfo: { name: 'zclaudia' },
    rootUri,
    workspaceFolders: [{ uri: rootUri, name: path.basename(root) }],
    initializationOptions,
    capabilities: {
      // JS string indices are UTF-16 code units, so columns need no conversion.
      general: { positionEncodings: ['utf-16'] },
      textDocument: {
        synchronization: { didSave: true, dynamicRegistration: false },
        publishDiagnostics: { relatedInformation: false, versionSupport: true },
        definition: { linkSupport: false },
        references: {},
        hover: { contentFormat: ['markdown', 'plaintext'] },
        documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        callHierarchy: {},
        rename: { prepareSupport: true },
      },
      workspace: {
        workspaceFolders: true,
        configuration: true,
        symbol: {},
        // Renames come back as plain text edits; file operations are refused.
        workspaceEdit: { documentChanges: true, resourceOperations: [] },
      },
      window: { workDoneProgress: false },
    },
  };
}

/**
 * The value at a dotted `section` of the launch settings (`python.analysis`
 * → settings.python.analysis), or null when the client has nothing to say.
 */
export function settingsSection(
  settings: Record<string, unknown> | undefined,
  section: string | undefined
): unknown {
  if (!settings || !section) return null;
  let value: unknown = settings;
  for (const key of section.split('.')) {
    if (!value || typeof value !== 'object' || !(key in value)) return null;
    value = (value as Record<string, unknown>)[key];
  }
  return value ?? null;
}

export class LspClient {
  private closed = false;

  private constructor(
    private readonly connection: ProtocolConnection,
    readonly capabilities: ServerCapabilities,
    private readonly transport: LanguageServerTransport
  ) {}

  static async start(
    transport: LanguageServerTransport,
    options: LspClientOptions
  ): Promise<LspClient> {
    const connection = createProtocolConnection(
      new StreamMessageReader(transport.reader as never),
      new StreamMessageWriter(transport.writer as never)
    );
    const rootUri = pathToFileURL(path.resolve(options.root)).href;
    // Requests servers send to clients. Acknowledge rather than leave them
    // unhandled: a MethodNotFound on registerCapability makes some servers
    // give up on features.
    connection.onRequest(
      'workspace/configuration',
      (params: { items?: Array<{ section?: string }> }) =>
        (params?.items ?? []).map(item => settingsSection(options.settings, item?.section))
    );
    connection.onRequest('workspace/workspaceFolders', () => [
      { uri: rootUri, name: path.basename(options.root) },
    ]);
    connection.onRequest('workspace/applyEdit', () => ({ applied: false }));
    for (const method of ACKNOWLEDGED_REQUESTS) connection.onRequest(method, () => null);
    connection.listen();
    try {
      // A server that dies before answering (missing component, bad args)
      // must fail the start now with its own words, not after the timeout.
      const diedEarly = transport.exited.then(({ code, signal }) => {
        const tail = transport.stderrTail().trim().split('\n').slice(-2).join(' | ');
        throw new LanguageServerStartupError(
          `language server exited during start-up (${signal ?? `code ${code}`})${tail ? `: ${tail}` : ''}`
        );
      });
      diedEarly.catch(() => undefined);
      const result = await withTimeout(
        Promise.race([
          connection.sendRequest(
            'initialize',
            initializeParams(options.root, options.initializationOptions)
          ) as Promise<InitializeResult>,
          diedEarly,
        ]),
        options.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT_MS,
        'initialize'
      );
      await connection.sendNotification('initialized', {});
      const client = new LspClient(connection, result.capabilities ?? {}, transport);
      void transport.exited.then(() => {
        client.closed = true;
        connection.dispose();
      });
      return client;
    } catch (err) {
      connection.dispose();
      transport.kill();
      throw err;
    }
  }

  get pid(): number | null {
    return this.transport.pid ?? null;
  }

  get processId(): string | null {
    return this.transport.processId ?? null;
  }

  get exited(): LanguageServerTransport['exited'] {
    return this.transport.exited;
  }

  stderrTail(): string {
    return this.transport.stderrTail();
  }

  /** Whether the server asked for didSave (textDocumentSync.save). */
  get wantsSave(): boolean {
    const sync = this.capabilities.textDocumentSync;
    return typeof sync === 'object' && sync !== null && Boolean(sync.save);
  }

  async notify(method: string, params: unknown): Promise<void> {
    if (this.closed) return;
    await this.connection.sendNotification(method, params);
  }

  onNotification(method: string, handler: (params: unknown) => void): () => void {
    const disposable = this.connection.onNotification(method, handler);
    return () => disposable.dispose();
  }

  async request<R>(method: string, params: unknown, signal?: AbortSignal): Promise<R> {
    if (this.closed) throw new Error('language server connection is closed');
    const source = new CancellationTokenSource();
    const onAbort = () => source.cancel();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return (await this.connection.sendRequest(method, params, source.token)) as R;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      source.dispose();
    }
  }

  /** shutdown → exit, then kill if the process lingers. */
  async stop(timeoutMs = DEFAULT_STOP_TIMEOUT_MS): Promise<void> {
    if (this.closed) return;
    try {
      await withTimeout(this.connection.sendRequest('shutdown'), timeoutMs, 'shutdown');
      await this.connection.sendNotification('exit');
    } catch {
      /* fall through to kill */
    }
    this.closed = true;
    const exited = await withTimeout(this.transport.exited, timeoutMs, 'exit').then(
      () => true,
      () => false
    );
    if (!exited) this.transport.kill();
    this.connection.dispose();
  }
}
