import { useEffect, useState } from 'react';
import { UnifiedDiffViewer } from '../../../components/renderers/DiffViewer';
import { getDeferredDiagnostics, restoreFileBackup, type DeferredDiagnosticsResult } from '../../../services/api';

type Diagnostic = {
  path?: string;
  line?: number;
  column?: number;
  severity?: string;
  message?: string;
  source?: string;
};

type FileMutationDetails = {
  ok?: boolean;
  path?: string;
  diff?: string;
  preview?: boolean;
  backup?: { id?: string; originalPath?: string; path?: string };
  perFileResults?: Array<{ path?: string; diff?: string; ok?: boolean; error?: string }>;
  lifecycle?: {
    diagnostics?: Diagnostic[];
    deferredDiagnostics?: { id?: string; status?: string };
    warnings?: string[];
    errors?: Array<{ code?: string; message?: string }>;
  };
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

export function getToolResultDetails(result: unknown): FileMutationDetails | undefined {
  const record = asRecord(result);
  const details = asRecord(record?.details);
  return details as FileMutationDetails | undefined;
}

function DiagnosticList({ diagnostics }: { diagnostics: Diagnostic[] }) {
  if (diagnostics.length === 0) return null;
  return (
    <div className="rounded-md border border-warning/30 bg-warning/10 p-2">
      <div className="text-[11px] font-medium text-warning mb-1">Diagnostics</div>
      <div className="space-y-1">
        {diagnostics.map((diagnostic, index) => (
          <div key={index} className="text-xs text-foreground">
            <span className="font-medium">{diagnostic.severity ?? 'info'}</span>
            {diagnostic.path && <span className="text-muted-foreground"> {diagnostic.path}</span>}
            {diagnostic.line && <span className="text-muted-foreground">:{diagnostic.line}</span>}
            {diagnostic.column && <span className="text-muted-foreground">:{diagnostic.column}</span>}
            <span> {diagnostic.message}</span>
            {diagnostic.source && <span className="text-muted-foreground"> ({diagnostic.source})</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function FileMutationResult({ details }: { details: FileMutationDetails }) {
  const perFileResults = details.perFileResults?.filter(file => typeof file.diff === 'string' && file.diff.trim().length > 0) ?? [];
  const deferredId = details.lifecycle?.deferredDiagnostics?.id;
  const initialDeferredStatus = details.lifecycle?.deferredDiagnostics?.status ?? 'pending';
  const [deferredResult, setDeferredResult] = useState<DeferredDiagnosticsResult | undefined>();
  const [restoreStatus, setRestoreStatus] = useState<'idle' | 'restoring' | 'restored' | 'failed'>('idle');
  const deferredStatus = deferredResult?.status ?? initialDeferredStatus;
  const diagnostics = [
    ...(details.lifecycle?.diagnostics ?? []),
    ...(deferredResult?.status === 'completed' ? deferredResult.diagnostics : []),
  ];

  useEffect(() => {
    if (!deferredId || initialDeferredStatus !== 'pending') return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refresh = async () => {
      attempts += 1;
      try {
        const result = await getDeferredDiagnostics(deferredId);
        if (cancelled) return;
        setDeferredResult(result);
        if (result.status === 'pending' && attempts < 5) {
          timer = setTimeout(refresh, 500);
        }
      } catch {
        if (!cancelled) setDeferredResult({ status: 'failed', error: 'Failed to load deferred diagnostics' });
      }
    };

    void refresh();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [deferredId, initialDeferredStatus]);

  const handleRestoreBackup = async () => {
    if (!details.backup?.id || restoreStatus === 'restoring') return;
    setRestoreStatus('restoring');
    try {
      await restoreFileBackup(details.backup.id);
      setRestoreStatus('restored');
    } catch {
      setRestoreStatus('failed');
    }
  };

  return (
    <div className="px-3 pb-3 border-t border-border/50">
      <div className="mt-2 space-y-3">
        {(details.preview || details.backup || details.lifecycle?.deferredDiagnostics) && (
          <div className="flex flex-wrap gap-1.5">
            {details.preview && (
              <span className="rounded-md border border-primary/30 bg-muted/60 px-2 py-0.5 text-[11px] text-primary">Preview only</span>
            )}
            {details.backup && (
              <span className="rounded-md border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] text-success" title={details.backup.path}>
                Backup created
              </span>
            )}
            {details.lifecycle?.deferredDiagnostics && (
              <span className="rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] text-warning">
                Diagnostics {deferredStatus}
              </span>
            )}
          </div>
        )}

        {details.backup?.id && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-[11px] text-foreground hover:bg-muted disabled:opacity-60"
              disabled={restoreStatus === 'restoring' || restoreStatus === 'restored'}
              onClick={handleRestoreBackup}
            >
              {restoreStatus === 'restoring' ? 'Restoring backup...' : restoreStatus === 'restored' ? 'Backup restored' : 'Restore backup'}
            </button>
            {restoreStatus === 'failed' && (
              <span className="text-[11px] text-destructive">Backup restore failed</span>
            )}
          </div>
        )}

        {perFileResults.length > 0 ? (
          <div className="space-y-3">
            {perFileResults.map((file, index) => (
              <div key={`${file.path ?? 'file'}:${index}`} className="space-y-1.5">
                {file.path && <div className="text-xs font-mono text-muted-foreground">{file.path}</div>}
                <UnifiedDiffViewer diff={file.diff ?? ''} filePath={file.path} />
              </div>
            ))}
          </div>
        ) : details.diff ? (
          <UnifiedDiffViewer diff={details.diff} filePath={details.path} />
        ) : null}

        <DiagnosticList diagnostics={diagnostics} />

        {(details.lifecycle?.warnings?.length || details.lifecycle?.errors?.length) ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            {[...(details.lifecycle.warnings ?? []), ...(details.lifecycle.errors ?? []).map(error => error.message ?? error.code ?? 'error')]
              .filter(Boolean)
              .join('\n')}
          </div>
        ) : null}

        {deferredResult?.status === 'failed' ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            {deferredResult.error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
