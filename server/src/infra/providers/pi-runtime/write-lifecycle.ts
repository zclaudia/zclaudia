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
}

export interface WriteLifecycleResult {
  diagnostics?: WriteLifecycleDiagnostic[];
  notifications?: string[];
  warnings?: string[];
  errors?: Array<{ code: string; message: string }>;
  deferredDiagnostics?: { id: string; status: 'pending' };
}

export interface WriteLifecycleHooks {
  afterWrite?(
    input: WriteLifecycleInput
  ): Promise<WriteLifecycleResult | void> | WriteLifecycleResult | void;
  timeoutMs?: number;
}

export type WriteDiagnosticsProvider = (
  input: WriteLifecycleInput
) => Promise<WriteLifecycleDiagnostic[]> | WriteLifecycleDiagnostic[];

export type DiagnosticsMode = 'inline' | 'deferred';

export type DeferredDiagnosticsResult =
  | { status: 'pending' }
  | { status: 'completed'; diagnostics: WriteLifecycleDiagnostic[] }
  | { status: 'failed'; error: string };

const deferredDiagnostics = new Map<string, DeferredDiagnosticsResult>();

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
  };
}

export async function runDiagnosticsProvider(
  provider: WriteDiagnosticsProvider | undefined,
  input: WriteLifecycleInput
): Promise<WriteLifecycleResult | undefined> {
  if (!provider) return undefined;
  try {
    const diagnostics = await provider(input);
    return diagnostics.length > 0 ? { diagnostics } : undefined;
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
  const id = randomUUID();
  deferredDiagnostics.set(id, { status: 'pending' });
  Promise.resolve()
    .then(() => provider(input))
    .then(diagnostics => {
      deferredDiagnostics.set(id, { status: 'completed', diagnostics });
    })
    .catch(err => {
      deferredDiagnostics.set(id, {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    });
  return { deferredDiagnostics: { id, status: 'pending' } };
}

export function getDeferredDiagnosticsResult(id: string): DeferredDiagnosticsResult | undefined {
  return deferredDiagnostics.get(id);
}
