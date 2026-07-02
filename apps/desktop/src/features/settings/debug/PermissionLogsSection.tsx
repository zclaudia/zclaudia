import { useState, useEffect, useCallback } from 'react';
import * as api from '../../../services/api';
import type { PermissionLogEntry } from '../../../services/api/debug';
import { SettingsRow } from '../ui/SettingsGroup';

export function PermissionLogsSection() {
  const [permLogs, setPermLogs] = useState<PermissionLogEntry[]>([]);
  const [permLogsTotal, setPermLogsTotal] = useState(0);
  const [permLogsLoading, setPermLogsLoading] = useState(false);
  const [permLogsError, setPermLogsError] = useState<string | null>(null);
  const [permLogsFilter, setPermLogsFilter] = useState<string>('');
  const PERM_LOGS_LIMIT = 20;

  const loadPermissionLogs = useCallback(async (offset = 0, decision?: string) => {
    setPermLogsLoading(true);
    setPermLogsError(null);
    try {
      const result = await api.getPermissionLogs({
        limit: PERM_LOGS_LIMIT,
        offset,
        decision: decision || undefined,
      });
      setPermLogs(offset === 0 ? result.entries : prev => [...prev, ...result.entries]);
      setPermLogsTotal(result.total);
    } catch (err) {
      setPermLogsError(err instanceof Error ? err.message : 'Failed to load permission logs');
    } finally {
      setPermLogsLoading(false);
    }
  }, []);

  // Auto-load permission logs on mount
  useEffect(() => {
    void loadPermissionLogs(0, permLogsFilter);
  }, [loadPermissionLogs, permLogsFilter]);

  return (
    <SettingsRow
      align="start"
      title="Permission logs"
      description="Historical permission decisions (auto-approve, user decisions, AI review)."
      control={
        <button
          onClick={() => {
            setPermLogs([]);
            void loadPermissionLogs(0, permLogsFilter);
          }}
          disabled={permLogsLoading}
          className="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 disabled:bg-muted disabled:text-muted-foreground text-secondary-foreground rounded-lg transition-colors"
        >
          {permLogsLoading ? 'Loading…' : 'Refresh'}
        </button>
      }
    >
      <div className="space-y-3">
        {/* Filter */}
        <div className="flex gap-1">
          {(['', 'allow', 'deny'] as const).map(filter => (
            <button
              key={filter}
              onClick={() => {
                setPermLogs([]);
                setPermLogsFilter(filter);
              }}
              className={`px-2 py-0.5 text-[11px] rounded-md transition-colors ${
                permLogsFilter === filter
                  ? 'bg-muted/60 text-foreground'
                  : 'bg-secondary/80 text-muted-foreground hover:text-foreground'
              }`}
            >
              {filter === '' ? 'All' : filter === 'allow' ? 'Allow' : 'Deny'}
            </button>
          ))}
        </div>

        {permLogsError && <div className="text-xs text-destructive">{permLogsError}</div>}
        {!permLogsError && permLogs.length === 0 && !permLogsLoading && (
          <div className="text-xs text-muted-foreground">No permission logs recorded.</div>
        )}
        {permLogs.length > 0 && (
          <div className="space-y-1.5 max-h-80 overflow-auto">
            {permLogs.map(entry => (
              <div key={entry.id} className="p-2 bg-secondary/40 rounded-md flex items-start gap-2">
                <span
                  className={`mt-0.5 flex-shrink-0 w-1.5 h-1.5 rounded-full ${
                    entry.decision === 'allow' ? 'bg-green-500' : 'bg-red-500'
                  }`}
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <code className="text-[11px] font-medium truncate">{entry.tool}</code>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {entry.remembered === 1 && (
                        <span className="text-[10px] text-muted-foreground">remembered</span>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(entry.created_at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  {entry.detail && (
                    <div className="text-[11px] text-muted-foreground truncate">{entry.detail}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {permLogs.length > 0 && permLogs.length < permLogsTotal && (
          <button
            onClick={() => {
              void loadPermissionLogs(permLogs.length, permLogsFilter);
            }}
            disabled={permLogsLoading}
            className="w-full py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {permLogsLoading ? 'Loading…' : `Load more (${permLogs.length}/${permLogsTotal})`}
          </button>
        )}
      </div>
    </SettingsRow>
  );
}
