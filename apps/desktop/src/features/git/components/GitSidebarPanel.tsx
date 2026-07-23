import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitBranch as BranchIcon, ChevronDown, RefreshCw } from 'lucide-react';
import * as api from '../../../services/api';
import { useGitStore, selectStatus } from '../store';
import { resolveEffectiveWorktree } from '../resolveWorktree';
import { SyncButtons } from './SyncButtons';
import { GitStatusView } from './GitStatusView';
import { GitLogView } from './GitLogView';
import { GitBranchesView } from './GitBranchesView';
import { GitStashView } from './GitStashView';

type SubTab = 'status' | 'commits' | 'branches' | 'stash';

interface GitSidebarPanelProps {
  projectId?: string;
  projectRoot?: string;
  workingDirectory?: string;
  panelId?: string;
}

export function GitSidebarPanel({
  projectId,
  projectRoot,
  workingDirectory,
}: GitSidebarPanelProps) {
  const [override, setOverride] = useState<string | null>(null);
  const [tab, setTab] = useState<SubTab>('status');
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [spinning, setSpinning] = useState(false);

  const worktrees = useGitStore(s => (projectId ? (s.worktrees[projectId] ?? []) : []));
  const setWorktrees = useGitStore(s => s.setWorktrees);
  const setStatus = useGitStore(s => s.setStatus);

  // Reset the manual override whenever the active session's worktree changes,
  // so the panel follows the session by default.
  useEffect(() => {
    setOverride(null);
  }, [workingDirectory, projectRoot]);

  // Load the project's worktrees for the switcher.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api
      .getProjectWorktrees(projectId)
      .then(list => {
        if (!cancelled) setWorktrees(projectId, list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, setWorktrees]);

  const effectivePath = resolveEffectiveWorktree(override, workingDirectory, projectRoot);
  const status = useGitStore(selectStatus(projectId ?? '', effectivePath ?? ''));

  const refreshStatus = useCallback(async () => {
    if (!projectId || !effectivePath) return;
    try {
      const next = await api.getWorktreeStatus(projectId, effectivePath);
      setStatus(projectId, effectivePath, next);
    } catch {
      // ignore
    }
  }, [projectId, effectivePath, setStatus]);

  // Keep the header's ahead/behind counts fresh regardless of the active tab.
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const handleRefresh = useCallback(() => {
    setSpinning(true);
    setRefreshNonce(n => n + 1);
    void refreshStatus();
    window.setTimeout(() => setSpinning(false), 600);
  }, [refreshStatus]);

  const currentBranch = useMemo(
    () => worktrees.find(w => w.path === effectivePath)?.branch,
    [worktrees, effectivePath]
  );

  if (!projectId || !effectivePath) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-muted-foreground">
        <div>
          <p className="text-sm">No git worktree available.</p>
          <p className="text-xs mt-1">Open a session in a project with a local path to use git.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header: worktree switcher + sync, on a single row */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <BranchIcon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        {worktrees.length > 1 ? (
          <div className="relative min-w-0 flex-1">
            <select
              value={effectivePath}
              onChange={e => setOverride(e.target.value)}
              className="w-full appearance-none bg-background border border-border rounded-lg pl-2 pr-7 py-1 text-xs cursor-pointer outline-none transition-colors hover:bg-secondary focus:border-primary"
            >
              {worktrees.map(w => (
                <option key={w.path} value={w.path}>
                  {w.branch}
                  {w.isMain ? ' (main)' : ''}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {currentBranch ?? 'git'}
          </span>
        )}
        <SyncButtons
          projectId={projectId}
          worktreePath={effectivePath}
          ahead={status?.ahead ?? 0}
          behind={status?.behind ?? 0}
          onAfter={refreshStatus}
        />
      </div>

      {/* Tabs + shared refresh */}
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
            worktreePath={effectivePath}
            refreshNonce={refreshNonce}
          />
        )}
        {tab === 'commits' && (
          <GitLogView
            projectId={projectId}
            worktreePath={effectivePath}
            refreshNonce={refreshNonce}
          />
        )}
        {tab === 'branches' && (
          <GitBranchesView
            projectId={projectId}
            worktreePath={effectivePath}
            refreshNonce={refreshNonce}
            onAfterMutation={refreshStatus}
          />
        )}
        {tab === 'stash' && (
          <GitStashView
            projectId={projectId}
            worktreePath={effectivePath}
            refreshNonce={refreshNonce}
            onAfterMutation={refreshStatus}
          />
        )}
      </div>
    </div>
  );
}
