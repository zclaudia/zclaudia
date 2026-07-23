import { useCallback, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import type { GitWorktree } from '@zclaudia/shared';
import * as api from '../../../services/api';
import { useGitStore, selectStatus } from '../store';
import { SyncButtons } from './SyncButtons';
import { GitStatusView } from './GitStatusView';
import { GitLogView } from './GitLogView';
import { GitBranchesView } from './GitBranchesView';
import { GitStashView } from './GitStashView';

type SubTab = 'status' | 'commits' | 'branches' | 'stash';

interface WorktreeDetailProps {
  projectId: string;
  worktree: GitWorktree;
  onRefreshList?: () => void | Promise<void>;
}

export function WorktreeDetail({ projectId, worktree, onRefreshList }: WorktreeDetailProps) {
  const [tab, setTab] = useState<SubTab>('status');
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const setStatus = useGitStore(s => s.setStatus);
  const status = useGitStore(selectStatus(projectId, worktree.path));

  const refreshStatus = useCallback(async () => {
    try {
      const next = await api.getWorktreeStatus(projectId, worktree.path);
      setStatus(projectId, worktree.path, next);
    } catch {
      // ignore
    }
  }, [projectId, worktree.path, setStatus]);

  const onAfterSync = useCallback(async () => {
    await refreshStatus();
    if (onRefreshList) await onRefreshList();
  }, [refreshStatus, onRefreshList]);

  const handleRefresh = useCallback(() => {
    setSpinning(true);
    setRefreshNonce(n => n + 1);
    void refreshStatus();
    window.setTimeout(() => setSpinning(false), 600);
  }, [refreshStatus]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold truncate">{worktree.branch}</span>
              {worktree.isMain && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                  main
                </span>
              )}
              {worktree.managedBy === 'supervisor' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                  supervisor
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span
                className="text-[11px] text-muted-foreground font-mono truncate"
                title={worktree.path}
              >
                {worktree.path}
              </span>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(worktree.path).catch(() => {})}
                className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                title="Copy path"
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
          </div>
          <SyncButtons
            projectId={projectId}
            worktreePath={worktree.path}
            ahead={status?.ahead ?? 0}
            behind={status?.behind ?? 0}
            onAfter={onAfterSync}
          />
        </div>
      </div>

      {/* Sub-tabs + shared refresh */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="inline-flex items-center gap-0.5 rounded-lg bg-secondary/60 p-1">
          {(['status', 'commits', 'branches', 'stash'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                tab === t
                  ? 'bg-background text-foreground shadow-apple-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${spinning ? 'animate-spin' : ''}`}
            strokeWidth={1.75}
          />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'status' && (
          <GitStatusView
            projectId={projectId}
            worktreePath={worktree.path}
            refreshNonce={refreshNonce}
          />
        )}
        {tab === 'commits' && (
          <GitLogView
            projectId={projectId}
            worktreePath={worktree.path}
            refreshNonce={refreshNonce}
          />
        )}
        {tab === 'branches' && (
          <GitBranchesView
            projectId={projectId}
            worktreePath={worktree.path}
            refreshNonce={refreshNonce}
            onAfterMutation={onAfterSync}
          />
        )}
        {tab === 'stash' && (
          <GitStashView
            projectId={projectId}
            worktreePath={worktree.path}
            refreshNonce={refreshNonce}
            onAfterMutation={refreshStatus}
          />
        )}
      </div>
    </div>
  );
}
