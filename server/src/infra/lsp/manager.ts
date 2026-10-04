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
import { LspClient } from './client.js';
import { DiagnosticsStore } from './diagnostics.js';
import { DocumentStore } from './documents.js';
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

export interface LanguageServerManagerOptions {
  presets?: LanguageServerPreset[];
  spawn?: SpawnLanguageServer;
  maxServers?: number;
  idleTimeoutMs?: number;
  initializeTimeoutMs?: number;
  settleMs?: number;
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

  constructor(private readonly options: LanguageServerManagerOptions = {}) {
    this.presets = options.presets ?? defaultLanguageServerPresets();
    this.spawn = options.spawn ?? spawnLanguageServer;
    this.maxServers = Math.max(1, options.maxServers ?? DEFAULT_MAX_SERVERS);
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  serversFor(root: string): LanguageServerInfo[] {
    return this.availablePresets(path.resolve(root)).map(info);
  }

  acquire(root: string, consumer: string): { release(): void } {
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

  status(): LanguageServerStatus[] {
    return [...this.entries.values()].map(entry => ({
      id: entry.preset.id,
      name: entry.preset.name,
      root: entry.root,
      state: entry.state,
      leases: [...entry.leases.values()],
      openDocuments: entry.active?.documents.size ?? 0,
      pid: entry.active?.client.pid ?? null,
      processId: entry.active?.client.processId ?? null,
      startedAt: entry.startedAt,
      lastUsedAt: entry.lastUsedAt,
      lastError: entry.lastError,
    }));
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
      this.recordCrash(entry, err instanceof Error ? err.message : String(err));
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
