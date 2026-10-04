/**
 * LanguageServerManager — owns every language-server process the server runs.
 *
 * One client per (preset id, workspace root). Clients start on first use (or
 * when a consumer acquires a lease, which doubles as warm-up), stay alive
 * while leased, stop after `idleTimeoutMs` without leases, and are capped at
 * `maxServers` live processes with LRU eviction of unleased ones. A crashed
 * server restarts lazily with exponential backoff and is marked failed after
 * repeated crashes. See docs/plans/2026-10-04-lsp-manager-plan.md.
 */
import path from 'path';
import { LanguageServerStartupError, LspClient } from './client.js';
import { DiagnosticsStore } from './diagnostics.js';
import { DocumentStore, fileUri, type SyncOutcome } from './documents.js';
import {
  attachPreviews,
  definitionLocations,
  hoverText,
  incomingCalls,
  pruneSymbols,
  referenceLocations,
  symbolList,
  symbolLocations,
} from './query.js';
import {
  LanguageServerError,
  type LspQueryRequest,
  type LspQueryResult,
} from '../providers/language-server-port.js';
import { findFirstSourceFile } from './detection.js';
import { defaultLanguageServerPresets } from './presets.js';
import { spawnLanguageServer } from './spawn.js';
import type {
  DiagnosticsCheck,
  DiagnosticsRequest,
  LanguageServerInfo,
  LanguageServerPreset,
  LanguageServerService,
  LanguageServerState,
  LanguageServerStatus,
  LspDiagnostic,
  SpawnLanguageServer,
} from './types.js';

const DEFAULT_MAX_SERVERS = 3;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const CRASH_WINDOW_MS = 5 * 60 * 1000;
const MAX_CRASHES_IN_WINDOW = 3;
const MAX_BACKOFF_MS = 30_000;
const BASELINE_BUDGET_MS = 1_500;
/** How long a query waits for a cold server before answering server_starting. */
const DEFAULT_START_WAIT_MS = 20_000;
const QUERY_DIAGNOSTICS_BUDGET_MS = 5_000;
/**
 * How long a query waits, after opening a file, for its project to load.
 * tsserver answers early requests from a partial project (definition stops at
 * the import line); its first diagnostics publish marks the load finished.
 */
const PROJECT_LOAD_WAIT_MS = 15_000;
const ERROR_MESSAGE_MAX_CHARS = 300;
const DEFAULT_MAX_RESULTS = 50;
const DISABLED_MESSAGE = 'Language servers are turned off in Settings';

/** Server capability each query action needs. */
const ACTION_CAPABILITY = {
  definition: 'definitionProvider',
  references: 'referencesProvider',
  hover: 'hoverProvider',
  documentSymbols: 'documentSymbolProvider',
  workspaceSymbols: 'workspaceSymbolProvider',
  incomingCalls: 'callHierarchyProvider',
} as const;

export interface LanguageServerManagerOptions {
  presets?: LanguageServerPreset[];
  spawn?: SpawnLanguageServer;
  maxServers?: number;
  idleTimeoutMs?: number;
  initializeTimeoutMs?: number;
  settleMs?: number;
  startWaitMs?: number;
  /** Initial value of the user's master switch (Settings → Language servers). */
  enabled?: boolean;
  now?: () => number;
}

interface ActiveClient {
  client: LspClient;
  documents: DocumentStore;
  diagnostics: DiagnosticsStore;
}

interface Entry {
  key: string;
  preset: LanguageServerPreset;
  root: string;
  state: LanguageServerState;
  active: ActiveClient | null;
  starting: Promise<ActiveClient | null> | null;
  stopping: boolean;
  leases: Map<symbol, string>;
  /** Last settled diagnostics per absolute file: the baseline for the next change. */
  stable: Map<string, DiagnosticsCheck & { state: 'ready' }>;
  crashes: number[];
  nextStartAt: number;
  startedAt: number | null;
  lastUsedAt: number | null;
  lastError: string | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

function info(preset: LanguageServerPreset): LanguageServerInfo {
  return { id: preset.id, name: preset.name, languages: preset.languages };
}

/** First lines of a server error, without the stack trace servers append. */
function condenseServerError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const lines = message
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('at ') && !line.startsWith('Error: '));
  const text = lines
    .slice(0, 2)
    .join(' ')
    .replace(/^<[^>]+>\s*/, '');
  return text.length > ERROR_MESSAGE_MAX_CHARS
    ? `${text.slice(0, ERROR_MESSAGE_MAX_CHARS)}…`
    : text;
}

function isInside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export class LanguageServerManager implements LanguageServerService {
  private readonly presets: LanguageServerPreset[];
  private readonly spawn: SpawnLanguageServer;
  private readonly maxServers: number;
  private readonly idleTimeoutMs: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry>();
  private disposed = false;
  private enabled: boolean;

  constructor(private readonly options: LanguageServerManagerOptions = {}) {
    this.presets = options.presets ?? defaultLanguageServerPresets();
    this.spawn = options.spawn ?? spawnLanguageServer;
    this.maxServers = Math.max(1, options.maxServers ?? DEFAULT_MAX_SERVERS);
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
    this.enabled = options.enabled ?? true;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * The user's master switch. Off stops every server and makes the manager
   * offer nothing (no LSPTool, no write diagnostics); on clears failed
   * servers so a fixed installation gets a fresh start.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      await Promise.all([...this.entries.values()].map(entry => this.stop(entry)));
      return;
    }
    for (const entry of this.entries.values()) {
      if (entry.state === 'failed') {
        entry.state = 'idle';
        entry.lastError = null;
        entry.crashes = [];
        entry.nextStartAt = 0;
      }
    }
  }

  serversFor(root: string): LanguageServerInfo[] {
    if (!this.enabled) return [];
    const resolvedRoot = path.resolve(root);
    // A server that failed here (e.g. a rustup proxy without the component)
    // is detected but cannot answer: stop offering it until the process
    // restarts or a later preset probe changes.
    return this.availablePresets(resolvedRoot)
      .filter(preset => this.entries.get(`${preset.id}::${resolvedRoot}`)?.state !== 'failed')
      .map(info);
  }

  acquire(root: string, consumer: string): { release(): void } {
    if (!this.enabled) return { release: () => undefined };
    const resolvedRoot = path.resolve(root);
    const token = Symbol(consumer);
    const leased = this.availablePresets(resolvedRoot).map(preset => {
      const entry = this.entryFor(preset, resolvedRoot);
      entry.leases.set(token, consumer);
      this.clearIdle(entry);
      // Warm-up: the first edit should not pay the server's start-up.
      void this.ensureStarted(entry);
      return entry;
    });
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        for (const entry of leased) {
          entry.leases.delete(token);
          this.scheduleIdle(entry);
        }
      },
    };
  }

  async diagnosticsFor(
    root: string,
    file: string,
    request: DiagnosticsRequest
  ): Promise<DiagnosticsCheck> {
    if (!this.enabled) return { state: 'unavailable', reason: DISABLED_MESSAGE };
    const resolvedRoot = path.resolve(root);
    const absolute = path.resolve(resolvedRoot, file);
    if (!isInside(resolvedRoot, absolute)) {
      return { state: 'unavailable', reason: 'file is outside the workspace' };
    }
    const preset = this.presetForFile(resolvedRoot, absolute);
    if (!preset) return { state: 'unavailable', reason: 'no language server for this file' };
    const entry = this.entryFor(preset, resolvedRoot);
    this.touch(entry);
    const server = info(preset);

    if (entry.state === 'failed') {
      return { state: 'unavailable', reason: entry.lastError ?? 'language server failed' };
    }
    // Never block a write on start-up: kick it off and report honestly.
    if (!entry.active) {
      const starting = this.ensureStarted(entry);
      if (!starting) {
        return { state: 'unavailable', reason: entry.lastError ?? 'language server unavailable' };
      }
      return { state: 'pending', server, reason: 'starting' };
    }

    const { documents, diagnostics } = entry.active;
    const settleMs = this.options.settleMs;
    let baseline: LspDiagnostic[] | undefined = entry.stable.get(absolute)?.diagnostics;
    try {
      // First sight of this file: diagnose the old content first, so the
      // report can separate what this change introduced from what was there.
      if (!documents.isOpen(absolute) && request.baselineContent !== undefined) {
        if (request.baselineContent === null) {
          baseline = [];
        } else {
          const mark = diagnostics.mark(absolute);
          await documents.syncText(absolute, request.baselineContent);
          const before = await diagnostics.waitForPublishAfter(absolute, mark, {
            budgetMs: Math.min(BASELINE_BUDGET_MS, request.budgetMs),
            settleMs,
            signal: request.signal,
          });
          baseline = before ?? undefined;
        }
      }
      const mark = diagnostics.mark(absolute);
      const outcome = await documents.syncFromDisk(absolute);
      if (outcome === 'missing') return { state: 'unavailable', reason: 'file does not exist' };
      // Unchanged content gets no new publish; serve what the server last said.
      const cached =
        outcome === 'unchanged'
          ? (entry.stable.get(absolute)?.diagnostics ?? diagnostics.latest(absolute))
          : undefined;
      const settled =
        cached ??
        (await diagnostics.waitForPublishAfter(absolute, mark, {
          budgetMs: request.budgetMs,
          settleMs,
          signal: request.signal,
        }));
      if (!settled) return { state: 'pending', server, reason: 'timeout' };
      const check: DiagnosticsCheck & { state: 'ready' } = {
        state: 'ready',
        server,
        diagnostics: settled,
        ...(baseline ? { baseline } : {}),
      };
      entry.stable.set(absolute, { state: 'ready', server, diagnostics: settled });
      return check;
    } catch (err) {
      return {
        state: 'unavailable',
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async query(request: LspQueryRequest, signal?: AbortSignal): Promise<LspQueryResult> {
    try {
      return await this.runQuery(request, signal);
    } catch (err) {
      if (err instanceof LanguageServerError) throw err;
      throw new LanguageServerError('request_failed', condenseServerError(err));
    }
  }

  private async runQuery(request: LspQueryRequest, signal?: AbortSignal): Promise<LspQueryResult> {
    if (!this.enabled) throw new LanguageServerError('server_unavailable', DISABLED_MESSAGE);
    const root = path.resolve(request.cwd);
    const file = request.file ? path.resolve(root, request.file) : undefined;
    const maxResults = Math.max(1, request.maxResults ?? DEFAULT_MAX_RESULTS);
    if (file && !isInside(root, file)) {
      throw new LanguageServerError('unsupported_language', 'File is outside the workspace');
    }

    if (request.action === 'workspaceSymbols') {
      const presets = this.availablePresets(root);
      if (presets.length === 0) {
        throw new LanguageServerError(
          'server_unavailable',
          'No language server is configured for this workspace'
        );
      }
      const lists = await Promise.all(
        presets.map(async preset => {
          const active = await this.activeFor(this.entryFor(preset, root));
          this.requireCapability(active, preset, 'workspaceSymbols');
          await active.documents.syncOpenFromDisk();
          // Symbol search covers the projects of open files; with none open
          // tsserver has no project at all, so load one from a source file.
          if (active.documents.size === 0) {
            const anchor = findFirstSourceFile(root, Object.keys(preset.extensions));
            if (!anchor) {
              throw new LanguageServerError(
                'server_unavailable',
                `No ${preset.name} source file found to load a project from`
              );
            }
            await this.openAndAwaitProject(active, anchor, signal);
          }
          const raw = await active.client.request(
            'workspace/symbol',
            { query: request.query ?? '' },
            signal
          );
          return { symbols: symbolList(root, null, raw), openFiles: active.documents.size };
        })
      );
      const { symbols, truncated } = pruneSymbols(
        lists.flatMap(list => list.symbols),
        maxResults
      );
      await attachPreviews(root, symbolLocations(symbols));
      // Servers search the projects they have loaded, i.e. those of files
      // opened so far; in a multi-package workspace an empty answer is not
      // proof of absence, so say what was covered.
      const openFiles = lists.reduce((sum, list) => sum + list.openFiles, 0);
      const note =
        symbols.length === 0
          ? `Searched only the projects of the ${openFiles} file(s) opened so far. In a multi-package workspace, run symbols on a file of another package (or a positional action) to load it, then search again.`
          : undefined;
      return {
        action: 'workspaceSymbols',
        symbols,
        ...(truncated ? { truncated } : {}),
        ...(note ? { note } : {}),
      };
    }

    if (!file) {
      throw new LanguageServerError('unsupported_action', `${request.action} requires a file`);
    }
    const preset = this.presetForFile(root, file);
    if (!preset) {
      throw new LanguageServerError(
        'unsupported_language',
        `No language server handles ${path.extname(file) || 'this kind of'} files here`
      );
    }
    const entry = this.entryFor(preset, root);
    const active = await this.activeFor(entry);

    if (request.action === 'diagnostics') {
      const check = await this.diagnosticsFor(root, file, {
        budgetMs: QUERY_DIAGNOSTICS_BUDGET_MS,
        signal,
      });
      if (check.state === 'unavailable') {
        throw new LanguageServerError('server_unavailable', check.reason);
      }
      if (check.state === 'pending')
        return { action: 'diagnostics', state: 'pending', diagnostics: [] };
      const diagnostics = check.diagnostics.slice(0, maxResults);
      return {
        action: 'diagnostics',
        state: 'ready',
        diagnostics,
        ...(check.diagnostics.length > maxResults ? { truncated: true } : {}),
      };
    }

    this.requireCapability(active, preset, request.action);
    // Open documents override the disk for the server; refresh them all, then
    // the queried file, so answers reflect edits made by any means.
    await active.documents.syncOpenFromDisk();
    if ((await this.openAndAwaitProject(active, file, signal)) === 'missing') {
      throw new LanguageServerError('unsupported_language', 'File does not exist');
    }
    const textDocument = { uri: fileUri(file) };

    if (request.action === 'documentSymbols') {
      const raw = await active.client.request(
        'textDocument/documentSymbol',
        { textDocument },
        signal
      );
      const { symbols, truncated } = pruneSymbols(
        symbolList(root, textDocument.uri, raw),
        maxResults
      );
      await attachPreviews(root, symbolLocations(symbols));
      return { action: 'documentSymbols', symbols, ...(truncated ? { truncated } : {}) };
    }

    if (!request.line || !request.character) {
      throw new LanguageServerError('unsupported_action', `${request.action} requires a position`);
    }
    const position = { line: request.line - 1, character: request.character - 1 };

    switch (request.action) {
      case 'hover': {
        const raw = await active.client.request(
          'textDocument/hover',
          { textDocument, position },
          signal
        );
        return { action: 'hover', contents: hoverText(raw) };
      }
      case 'definition':
      case 'references': {
        const raw =
          request.action === 'definition'
            ? await active.client.request(
                'textDocument/definition',
                { textDocument, position },
                signal
              )
            : await active.client.request(
                'textDocument/references',
                { textDocument, position, context: { includeDeclaration: true } },
                signal
              );
        const all =
          request.action === 'definition'
            ? definitionLocations(root, raw)
            : referenceLocations(root, raw);
        const locations = all.slice(0, maxResults);
        await attachPreviews(root, locations);
        return {
          action: request.action,
          locations,
          ...(all.length > maxResults ? { truncated: true } : {}),
        };
      }
      case 'incomingCalls': {
        const items = await active.client.request<unknown[] | null>(
          'textDocument/prepareCallHierarchy',
          { textDocument, position },
          signal
        );
        if (!items?.length) return { action: 'incomingCalls', calls: [] };
        const raw = await active.client.request(
          'callHierarchy/incomingCalls',
          { item: items[0] },
          signal
        );
        const all = incomingCalls(root, raw);
        const calls = all.slice(0, maxResults);
        await attachPreviews(
          root,
          calls.flatMap(call => [call.caller.location, ...call.callSites])
        );
        return {
          action: 'incomingCalls',
          calls,
          ...(all.length > maxResults ? { truncated: true } : {}),
        };
      }
    }
  }

  /** Every server instance this manager has created (Settings overview). */
  status(): LanguageServerStatus[] {
    return [...this.entries.values()].map(entry => this.statusOf(entry));
  }

  /**
   * Servers detected for one workspace, running or not, including failed
   * ones (unlike `serversFor`, which only lists what can answer).
   */
  statusFor(root: string): LanguageServerStatus[] {
    if (!this.enabled) return [];
    const resolvedRoot = path.resolve(root);
    return this.availablePresets(resolvedRoot).map(preset =>
      this.statusOf(this.entryFor(preset, resolvedRoot))
    );
  }

  private statusOf(entry: Entry): LanguageServerStatus {
    return {
      id: entry.preset.id,
      name: entry.preset.name,
      languages: entry.preset.languages,
      root: entry.root,
      state: entry.state,
      leases: [...entry.leases.values()],
      openDocuments: entry.active?.documents.size ?? 0,
      pid: entry.active?.client.pid ?? null,
      processId: entry.active?.client.processId ?? null,
      startedAt: entry.startedAt,
      lastUsedAt: entry.lastUsedAt,
      lastError: entry.lastError,
    };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.all([...this.entries.values()].map(entry => this.stop(entry)));
  }

  // --- internals -----------------------------------------------------------

  private availablePresets(root: string): LanguageServerPreset[] {
    return this.presets.filter(preset => {
      try {
        return preset.resolveLaunch(root) !== null;
      } catch {
        return false;
      }
    });
  }

  private presetForFile(root: string, file: string): LanguageServerPreset | undefined {
    const ext = path.extname(file).toLowerCase();
    return this.availablePresets(root).find(preset => ext in preset.extensions);
  }

  private entryFor(preset: LanguageServerPreset, root: string): Entry {
    const key = `${preset.id}::${root}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        key,
        preset,
        root,
        state: 'idle',
        active: null,
        starting: null,
        stopping: false,
        leases: new Map(),
        stable: new Map(),
        crashes: [],
        nextStartAt: 0,
        startedAt: null,
        lastUsedAt: null,
        lastError: null,
        idleTimer: null,
      };
      this.entries.set(key, entry);
    }
    return entry;
  }

  /** The entry's running client, starting it and waiting up to `startWaitMs`. */
  private async activeFor(entry: Entry): Promise<ActiveClient> {
    this.touch(entry);
    const starting = this.ensureStarted(entry);
    if (!starting) {
      throw new LanguageServerError(
        entry.state === 'failed' ? 'server_failed' : 'server_unavailable',
        entry.lastError ?? `${entry.preset.name} language server is unavailable`
      );
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const active = await Promise.race([
      starting,
      new Promise<'waiting'>(resolve => {
        timer = setTimeout(
          () => resolve('waiting'),
          this.options.startWaitMs ?? DEFAULT_START_WAIT_MS
        );
      }),
    ]).finally(() => clearTimeout(timer));
    if (active === 'waiting') {
      throw new LanguageServerError(
        'server_starting',
        `${entry.preset.name} language server is still starting; retry in a few seconds`
      );
    }
    if (!active) {
      throw new LanguageServerError(
        entry.state === 'failed' ? 'server_failed' : 'server_unavailable',
        entry.lastError ?? `${entry.preset.name} language server failed to start`
      );
    }
    return active;
  }

  /** Sync `file`; on first open, wait (bounded) for its project to finish loading. */
  private async openAndAwaitProject(
    active: ActiveClient,
    file: string,
    signal?: AbortSignal
  ): Promise<SyncOutcome> {
    const mark = active.diagnostics.mark(file);
    const outcome = await active.documents.syncFromDisk(file);
    if (outcome === 'opened') {
      await active.diagnostics.waitForPublishAfter(file, mark, {
        budgetMs: PROJECT_LOAD_WAIT_MS,
        settleMs: 0,
        signal,
      });
    }
    return outcome;
  }

  private requireCapability(
    active: ActiveClient,
    preset: LanguageServerPreset,
    action: keyof typeof ACTION_CAPABILITY
  ): void {
    if (!active.client.capabilities[ACTION_CAPABILITY[action]]) {
      throw new LanguageServerError(
        'unsupported_action',
        `The ${preset.name} language server does not support ${action}`
      );
    }
  }

  private touch(entry: Entry): void {
    entry.lastUsedAt = this.now();
    this.scheduleIdle(entry);
  }

  /** Returns the in-flight or new start, or null when starting is not allowed now. */
  private ensureStarted(entry: Entry): Promise<ActiveClient | null> | null {
    if (entry.active) return Promise.resolve(entry.active);
    if (entry.starting) return entry.starting;
    if (this.disposed || entry.state === 'failed') return null;
    if (this.now() < entry.nextStartAt) {
      entry.lastError = entry.lastError ?? 'language server restarting';
      return null;
    }
    if (!this.makeRoom(entry)) {
      entry.lastError = `language server limit reached (${this.maxServers} running)`;
      return null;
    }
    entry.state = 'starting';
    entry.starting = this.start(entry).finally(() => {
      entry.starting = null;
    });
    return entry.starting;
  }

  private makeRoom(entry: Entry): boolean {
    const live = [...this.entries.values()].filter(
      other => other !== entry && (other.active || other.starting)
    );
    if (live.length < this.maxServers) return true;
    const evictable = live
      .filter(other => other.leases.size === 0 && other.active)
      .sort((a, b) => (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0));
    if (evictable.length === 0) return false;
    void this.stop(evictable[0]);
    return true;
  }

  private async start(entry: Entry): Promise<ActiveClient | null> {
    const launch = entry.preset.resolveLaunch(entry.root);
    if (!launch) {
      entry.state = 'idle';
      entry.lastError = 'language server executable not found';
      return null;
    }
    try {
      const transport = await this.spawn(launch, { presetId: entry.preset.id, root: entry.root });
      const client = await LspClient.start(transport, {
        root: entry.root,
        initializationOptions: launch.initializationOptions,
        initializeTimeoutMs: this.options.initializeTimeoutMs,
      });
      const diagnostics = new DiagnosticsStore(entry.root);
      client.onNotification('textDocument/publishDiagnostics', params =>
        diagnostics.handlePublish(params)
      );
      const documents = new DocumentStore(client, file => {
        return entry.preset.extensions[path.extname(file).toLowerCase()] ?? 'plaintext';
      });
      const active: ActiveClient = { client, documents, diagnostics };
      if (this.disposed) {
        await client.stop();
        return null;
      }
      entry.active = active;
      entry.state = 'ready';
      entry.startedAt = this.now();
      entry.lastError = null;
      void client.exited.then(() => this.handleExit(entry, active));
      this.scheduleIdle(entry);
      return active;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof LanguageServerStartupError) {
        // Exiting before initialize is a setup problem (missing component,
        // bad install), not a flake: retrying would fail the same way.
        entry.state = 'failed';
        entry.lastError = message;
        return null;
      }
      this.recordCrash(entry, message);
      return null;
    }
  }

  private handleExit(entry: Entry, active: ActiveClient): void {
    if (entry.active !== active) return;
    entry.active = null;
    entry.stable.clear();
    if (entry.stopping || this.disposed) {
      entry.state = 'idle';
      return;
    }
    const tail = active.client.stderrTail().trim().split('\n').slice(-3).join(' | ');
    this.recordCrash(entry, `language server exited unexpectedly${tail ? `: ${tail}` : ''}`);
  }

  private recordCrash(entry: Entry, message: string): void {
    const now = this.now();
    entry.crashes = [...entry.crashes.filter(at => now - at < CRASH_WINDOW_MS), now];
    entry.lastError = message;
    if (entry.crashes.length >= MAX_CRASHES_IN_WINDOW) {
      entry.state = 'failed';
      return;
    }
    entry.state = 'stopped';
    entry.nextStartAt = now + Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (entry.crashes.length - 1));
  }

  private clearIdle(entry: Entry): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }

  private scheduleIdle(entry: Entry): void {
    this.clearIdle(entry);
    if (entry.leases.size > 0 || !entry.active) return;
    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = null;
      if (entry.leases.size === 0) void this.stop(entry);
    }, this.idleTimeoutMs);
    entry.idleTimer.unref?.();
  }

  private async stop(entry: Entry): Promise<void> {
    this.clearIdle(entry);
    const active = entry.active ?? (entry.starting ? await entry.starting : null);
    if (!active) return;
    entry.stopping = true;
    try {
      await active.documents.closeAll().catch(() => undefined);
      await active.client.stop();
    } finally {
      if (entry.active === active) entry.active = null;
      entry.stable.clear();
      entry.state = entry.state === 'failed' ? 'failed' : 'idle';
      entry.stopping = false;
    }
  }
}
