import { useCallback, useEffect } from 'react';
import * as api from '../../../services/api';
import { useGitStore, selectLog } from '../store';
import { useExternalRefresh } from '../useExternalRefresh';

interface GitLogViewProps {
  projectId: string;
  worktreePath: string;
  refreshNonce?: number;
}

function relativeDate(ts: number): string {
  const diff = Date.now() - ts;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function GitLogView({ projectId, worktreePath, refreshNonce }: GitLogViewProps) {
  const log = useGitStore(selectLog(projectId, worktreePath));
  const setLog = useGitStore(s => s.setLog);

  const refresh = useCallback(async () => {
    const next = await api.getGitLog(projectId, worktreePath, 50);
    setLog(projectId, worktreePath, next);
  }, [projectId, worktreePath, setLog]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  useExternalRefresh(refresh, refreshNonce);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {!log ? (
          <div className="px-3 py-3 text-xs text-muted-foreground">Loading…</div>
        ) : log.length === 0 ? (
          <div className="px-3 py-3 text-xs text-muted-foreground">No commits.</div>
        ) : (
          <div className="divide-y divide-border">
            {log.map(c => (
              <div key={c.sha} className="px-3 py-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-muted-foreground">{c.shortSha}</span>
                  <span className="truncate font-medium">{c.message}</span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {c.author} · {relativeDate(c.date)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
