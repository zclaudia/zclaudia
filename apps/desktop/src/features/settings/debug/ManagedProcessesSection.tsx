import { useState, useEffect, useCallback } from 'react';
import * as api from '../../../services/api';
import type { ManagedProcessRecord } from '../../../services/api/debug';
import { SettingsRow } from '../ui/SettingsGroup';
import { SECTION_LABEL } from '../../../components/ui/typography';

interface ManagedProcessesSectionProps {
  embeddedServerStatus: string;
}

export function ManagedProcessesSection({ embeddedServerStatus }: ManagedProcessesSectionProps) {
  const [managedProcesses, setManagedProcesses] = useState<ManagedProcessRecord[]>([]);
  const [managedProcessesLoading, setManagedProcessesLoading] = useState(false);
  const [managedProcessesError, setManagedProcessesError] = useState<string | null>(null);

  const handleRefreshProcesses = useCallback(async () => {
    setManagedProcessesLoading(true);
    try {
      const records = await api.getManagedProcesses();
      setManagedProcesses(records);
      setManagedProcessesError(null);
    } catch (err) {
      setManagedProcessesError(
        err instanceof Error ? err.message : 'Failed to load managed processes'
      );
    } finally {
      setManagedProcessesLoading(false);
    }
  }, []);

  // Auto-load managed processes on mount + poll every 5s
  useEffect(() => {
    if (embeddedServerStatus === 'disabled') return;

    let cancelled = false;

    const pollManagedProcesses = async () => {
      try {
        const records = await api.getManagedProcesses();
        if (!cancelled) {
          setManagedProcesses(prev => {
            if (
              prev.length === records.length &&
              prev.every(
                (p, i) => p.processId === records[i].processId && p.status === records[i].status
              )
            ) {
              return prev;
            }
            return records;
          });
          setManagedProcessesError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setManagedProcessesError(
            err instanceof Error ? err.message : 'Failed to load managed processes'
          );
        }
      }
    };

    void pollManagedProcesses();

    const interval = setInterval(() => {
      void pollManagedProcesses();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [embeddedServerStatus]);

  return (
    <SettingsRow
      align="start"
      title="Managed processes"
      description="Read-only process registry for product-owned commands and adopted roots."
      control={
        <button
          onClick={() => {
            void handleRefreshProcesses();
          }}
          disabled={managedProcessesLoading || embeddedServerStatus === 'disabled'}
          className="px-3 py-1 text-xs bg-secondary hover:bg-secondary/80 disabled:bg-muted disabled:text-muted-foreground text-secondary-foreground rounded-lg font-medium transition-colors max-md:py-2"
        >
          {managedProcessesLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      }
    >
      <div className="space-y-3">
        {managedProcessesError && (
          <div className="text-xs text-destructive">{managedProcessesError}</div>
        )}
        {!managedProcessesError && managedProcesses.length === 0 && !managedProcessesLoading && (
          <div className="text-xs text-muted-foreground">No managed processes recorded yet.</div>
        )}
        {managedProcesses.length > 0 && (
          <div className="space-y-2 max-h-72 overflow-auto">
            {managedProcesses.map(process => (
              <div key={process.processId} className="p-3 bg-secondary/40 rounded-md space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-medium break-all">
                    {process.command} {process.args.join(' ')}
                  </div>
                  <div className={SECTION_LABEL}>{process.status}</div>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span>{process.source}</span>
                  <span>pid {process.rootPid ?? process.pid ?? 'n/a'}</span>
                  <span>
                    {process.childCount} {process.childCount === 1 ? 'child' : 'children'}
                  </span>
                  {process.adopted && <span>adopted</span>}
                  {process.tags.length > 0 && <span>{process.tags.join(', ')}</span>}
                </div>
                {process.cwd && (
                  <div className="text-[11px] text-muted-foreground break-all">
                    cwd: {process.cwd}
                  </div>
                )}
                {(process.ownerSessionId || process.ownerTaskId) && (
                  <div className="text-[11px] text-muted-foreground break-all">
                    owner: {process.ownerSessionId ? `session ${process.ownerSessionId}` : ''}
                    {process.ownerSessionId && process.ownerTaskId ? ' • ' : ''}
                    {process.ownerTaskId ? `task ${process.ownerTaskId}` : ''}
                  </div>
                )}
                <div className="text-[11px] text-muted-foreground">
                  started {new Date(process.startedAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SettingsRow>
  );
}
