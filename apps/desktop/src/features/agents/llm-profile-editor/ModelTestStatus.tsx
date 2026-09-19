import type { ModelRowDraft } from '../llmProfileModelDraft';

export function ModelTestStatus({ status }: { status: ModelRowDraft['testStatus'] }) {
  if (!status) return <span className="text-[11px] text-muted-foreground" />;
  if (status.kind === 'running')
    return <span className="text-[11px] text-muted-foreground">Probing…</span>;
  if (status.kind === 'ok')
    return (
      <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
        ✓ {status.latencyMs} ms
      </span>
    );
  return (
    <span className="text-[11px] text-destructive truncate max-w-[280px]" title={status.error}>
      ✗ {status.error}
    </span>
  );
}
