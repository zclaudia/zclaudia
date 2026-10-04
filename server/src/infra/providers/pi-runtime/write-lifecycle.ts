import { randomUUID } from 'crypto';

export type WriteLifecycleOperation = 'edit' | 'write';
export type WriteLifecycleType = 'create' | 'update';

export interface WriteLifecycleDiagnostic {
  path: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  source?: string;
  code?: string | number;
}

/**
 * What a language-server check concluded about one write, for the model-facing
 * result text. Separate from `diagnostics` (the UI list) because the model
 * needs the *state* too: "not checked" must never read as "no errors".
 */
export interface WriteDiagnosticsReport {
  /** Display name of the checker, e.g. `TypeScript`. */
  checker: string;
  state: 'checked' | 'pending';
  pendingReason?: 'starting' | 'timeout';
  /** `unknown`: no pre-change diagnostics, so `errors` may include old ones. */
  baseline: 'known' | 'unknown';
  /** Errors introduced by the write (all errors when the baseline is unknown). */
  errors: WriteLifecycleDiagnostic[];
  /** Errors the write introduced in the server's other open files. */
  otherFiles?: { checked: number; errors: WriteLifecycleDiagnostic[] };
}

export interface WriteLifecycleInput {
  operation: WriteLifecycleOperation;
  type: WriteLifecycleType;
  path: string;
  absolutePath: string;
  originalContent: string | null;
  updatedContent: string;
  diff: string;
  firstChangedLine?: number;
  /** Absolute paths of other files the same mutation changed (multi-file patches). */
  otherChangedPaths?: string[];
}

export interface WriteLifecycleResult {
  diagnostics?: WriteLifecycleDiagnostic[];
  notifications?: string[];
  warnings?: string[];
  errors?: Array<{ code: string; message: string }>;
  deferredDiagnostics?: { id: string; status: 'pending' };
  diagnosticsReport?: WriteDiagnosticsReport;
}

export interface WriteLifecycleHooks {
  afterWrite?(
    input: WriteLifecycleInput
  ): Promise<WriteLifecycleResult | void> | WriteLifecycleResult | void;
  timeoutMs?: number;
}

/**
 * A plain list (command-based providers) or a report (language servers);
 * undefined when the provider does not apply to the file.
 */
export type WriteDiagnosticsOutcome =
  | WriteLifecycleDiagnostic[]
  | WriteDiagnosticsReport
  | undefined;

export type WriteDiagnosticsProvider = (
  input: WriteLifecycleInput
) => Promise<WriteDiagnosticsOutcome> | WriteDiagnosticsOutcome;

function outcomeDiagnostics(outcome: WriteDiagnosticsOutcome): WriteLifecycleDiagnostic[] {
  if (!outcome) return [];
  return Array.isArray(outcome) ? outcome : outcome.errors;
}

export type DiagnosticsMode = 'inline' | 'deferred';

export type DeferredDiagnosticsResult =
  | { status: 'pending' }
  | { status: 'completed'; diagnostics: WriteLifecycleDiagnostic[] }
  | { status: 'failed'; error: string };

interface DeferredDiagnosticsEntry {
  createdAt: number;
  result: DeferredDiagnosticsResult;
}

const deferredDiagnostics = new Map<string, DeferredDiagnosticsEntry>();

// Deferred results are polled once by the client and then forgotten; without
// eviction the map would grow by one entry per write for the process's life.
const DEFERRED_DIAGNOSTICS_TTL_MS = 10 * 60 * 1000;

// Lazy sweep (no timer): entries older than the TTL are evicted on access.
function sweepDeferredDiagnostics(now: number): void {
  for (const [id, entry] of deferredDiagnostics) {
    if (now - entry.createdAt > DEFERRED_DIAGNOSTICS_TTL_MS) deferredDiagnostics.delete(id);
  }
}

const DEFAULT_WRITE_LIFECYCLE_TIMEOUT_MS = 2_000;

function failureResult(code: string, message: string): WriteLifecycleResult {
  return {
    warnings: [`${code}: ${message}`],
    errors: [{ code, message }],
  };
}

export async function runWriteLifecycle(
  hooks: WriteLifecycleHooks | undefined,
  input: WriteLifecycleInput
): Promise<WriteLifecycleResult | undefined> {
  if (!hooks?.afterWrite) return undefined;
  try {
    const timeoutMs = Math.max(1, hooks.timeoutMs ?? DEFAULT_WRITE_LIFECYCLE_TIMEOUT_MS);
    const result = await Promise.race([
      Promise.resolve(hooks.afterWrite(input)),
      new Promise<WriteLifecycleResult>(resolve => {
        setTimeout(
          () =>
            resolve(failureResult('write_lifecycle_timeout', `afterWrite exceeded ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
    return result ?? undefined;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failureResult('write_lifecycle_failed', message);
  }
}

export function mergeWriteLifecycleResults(
  first: WriteLifecycleResult | undefined,
  second: WriteLifecycleResult | undefined
): WriteLifecycleResult | undefined {
  if (!first) return second;
  if (!second) return first;
  return {
    ...(first.diagnostics || second.diagnostics
      ? { diagnostics: [...(first.diagnostics ?? []), ...(second.diagnostics ?? [])] }
      : {}),
    ...(first.notifications || second.notifications
      ? { notifications: [...(first.notifications ?? []), ...(second.notifications ?? [])] }
      : {}),
    ...(first.warnings || second.warnings
      ? { warnings: [...(first.warnings ?? []), ...(second.warnings ?? [])] }
      : {}),
    ...(first.errors || second.errors
      ? { errors: [...(first.errors ?? []), ...(second.errors ?? [])] }
      : {}),
    ...(first.deferredDiagnostics || second.deferredDiagnostics
      ? { deferredDiagnostics: first.deferredDiagnostics ?? second.deferredDiagnostics }
      : {}),
    ...(first.diagnosticsReport || second.diagnosticsReport
      ? { diagnosticsReport: first.diagnosticsReport ?? second.diagnosticsReport }
      : {}),
  };
}

export async function runDiagnosticsProvider(
  provider: WriteDiagnosticsProvider | undefined,
  input: WriteLifecycleInput
): Promise<WriteLifecycleResult | undefined> {
  if (!provider) return undefined;
  try {
    const outcome = await provider(input);
    const diagnostics = outcomeDiagnostics(outcome);
    const report = outcome && !Array.isArray(outcome) ? outcome : undefined;
    if (!report && diagnostics.length === 0) return undefined;
    return {
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
      ...(report ? { diagnosticsReport: report } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failureResult('write_diagnostics_failed', message);
  }
}

export function scheduleDeferredDiagnostics(
  provider: WriteDiagnosticsProvider | undefined,
  input: WriteLifecycleInput
): WriteLifecycleResult | undefined {
  if (!provider) return undefined;
  sweepDeferredDiagnostics(Date.now());
  const id = randomUUID();
  deferredDiagnostics.set(id, { createdAt: Date.now(), result: { status: 'pending' } });
  Promise.resolve()
    .then(() => provider(input))
    .then(outcome => {
      const diagnostics = outcomeDiagnostics(outcome);
      const entry = deferredDiagnostics.get(id);
      // The entry may already be evicted (TTL) — dropping the result is fine,
      // late diagnostics are best-effort.
      if (entry) {
        deferredDiagnostics.set(id, {
          ...entry,
          result: { status: 'completed', diagnostics },
        });
      }
    })
    .catch(err => {
      const entry = deferredDiagnostics.get(id);
      if (entry) {
        deferredDiagnostics.set(id, {
          ...entry,
          result: {
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    });
  return { deferredDiagnostics: { id, status: 'pending' } };
}

export function getDeferredDiagnosticsResult(id: string): DeferredDiagnosticsResult | undefined {
  sweepDeferredDiagnostics(Date.now());
  const entry = deferredDiagnostics.get(id);
  if (!entry) return undefined;
  // Terminal results are single-read: the client stops polling once it has a
  // completed/failed result, so free the entry instead of holding it to the TTL.
  if (entry.result.status !== 'pending') deferredDiagnostics.delete(id);
  return entry.result;
}
