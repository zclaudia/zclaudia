/**
 * DiagnosticsStore — the server's pushed diagnostics, per file.
 *
 * Servers push `textDocument/publishDiagnostics` on their own schedule and may
 * push more than once per change (syntax first, semantics later), so "fresh"
 * means: at least one publish arrived after the caller's mark, and then none
 * for `settleMs`. A wait that runs out of budget before any publish returns
 * null — never an empty list, which would read as "no errors".
 */
import path from 'path';
import { fileURLToPath } from 'url';
import type { LspDiagnostic } from './types.js';
import { fileUri } from './documents.js';

const DEFAULT_SETTLE_MS = 150;

interface RawDiagnostic {
  range?: { start?: { line?: number; character?: number } };
  severity?: number;
  message?: string;
  source?: string;
  code?: string | number | { value?: string | number };
}

interface PublishParams {
  uri?: string;
  diagnostics?: RawDiagnostic[];
}

interface FileEntry {
  count: number;
  diagnostics: LspDiagnostic[];
}

const SEVERITIES: Record<number, LspDiagnostic['severity']> = {
  1: 'error',
  2: 'warning',
  3: 'information',
  4: 'hint',
};

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

export function mapDiagnostics(root: string, file: string, raw: RawDiagnostic[]): LspDiagnostic[] {
  const relative = toPosix(path.relative(root, file));
  return raw.map(diagnostic => {
    const code =
      typeof diagnostic.code === 'object' && diagnostic.code !== null
        ? diagnostic.code.value
        : diagnostic.code;
    return {
      file: relative,
      line: (diagnostic.range?.start?.line ?? 0) + 1,
      character: (diagnostic.range?.start?.character ?? 0) + 1,
      // The spec leaves a missing severity to the client; never escalate it.
      severity: SEVERITIES[diagnostic.severity ?? 3] ?? 'information',
      message: diagnostic.message ?? '',
      ...(diagnostic.source ? { source: diagnostic.source } : {}),
      ...(code !== undefined ? { code } : {}),
    };
  });
}

export interface WaitOptions {
  budgetMs: number;
  settleMs?: number;
  signal?: AbortSignal;
}

export class DiagnosticsStore {
  private readonly files = new Map<string, FileEntry>();
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(private readonly root: string) {}

  /** Feed one `textDocument/publishDiagnostics` notification. */
  handlePublish(raw: unknown): void {
    const params = raw as PublishParams;
    if (!params?.uri) return;
    let file: string;
    try {
      file = fileURLToPath(params.uri);
    } catch {
      return; // untitled: and other non-file documents
    }
    const uri = fileUri(file);
    const entry = this.files.get(uri) ?? { count: 0, diagnostics: [] };
    entry.count += 1;
    entry.diagnostics = mapDiagnostics(this.root, file, params.diagnostics ?? []);
    this.files.set(uri, entry);
    for (const listener of this.listeners.get(uri) ?? []) listener();
  }

  /** Publish counter for `file`; pass it to `waitForPublishAfter`. */
  mark(file: string): number {
    return this.files.get(fileUri(file))?.count ?? 0;
  }

  latest(file: string): LspDiagnostic[] | undefined {
    return this.files.get(fileUri(file))?.diagnostics;
  }

  /**
   * Wait for diagnostics published after `mark` to settle. Resolves null when
   * nothing arrived within the budget (or the wait was aborted).
   */
  waitForPublishAfter(
    file: string,
    mark: number,
    options: WaitOptions
  ): Promise<LspDiagnostic[] | null> {
    const uri = fileUri(file);
    const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
    const fresh = () => (this.files.get(uri)?.count ?? 0) > mark;
    return new Promise(resolve => {
      let settleTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (value: LspDiagnostic[] | null) => {
        clearTimeout(settleTimer);
        clearTimeout(budgetTimer);
        this.listeners.get(uri)?.delete(onPublish);
        options.signal?.removeEventListener('abort', onAbort);
        resolve(value);
      };
      const latestOrNull = () => (fresh() ? (this.latest(file) ?? []) : null);
      const onPublish = () => {
        if (!fresh()) return;
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => finish(latestOrNull()), settleMs);
      };
      const onAbort = () => finish(null);
      // Out of budget mid-settle still beats nothing: serve what arrived.
      const budgetTimer = setTimeout(() => finish(latestOrNull()), Math.max(0, options.budgetMs));
      const set = this.listeners.get(uri) ?? new Set();
      set.add(onPublish);
      this.listeners.set(uri, set);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.signal?.aborted) return finish(null);
      onPublish();
    });
  }
}

function diagnosticKey(diagnostic: LspDiagnostic): string {
  return [
    diagnostic.severity,
    diagnostic.source ?? '',
    diagnostic.code ?? '',
    diagnostic.message,
  ].join('\u0000');
}

/**
 * Diagnostics in `after` that `before` does not account for, compared as a
 * multiset on (severity, source, code, message) so that line shifts caused by
 * the edit do not turn every old problem into a "new" one.
 */
export function introducedDiagnostics(
  before: LspDiagnostic[],
  after: LspDiagnostic[]
): LspDiagnostic[] {
  const remaining = new Map<string, number>();
  for (const diagnostic of before) {
    const key = diagnosticKey(diagnostic);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  return after.filter(diagnostic => {
    const key = diagnosticKey(diagnostic);
    const left = remaining.get(key) ?? 0;
    if (left === 0) return true;
    remaining.set(key, left - 1);
    return false;
  });
}
