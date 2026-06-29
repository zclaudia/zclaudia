import { useCallback, useEffect, useState } from 'react';
import { GitBranch as BranchIcon, RefreshCw, Plus, Trash2 } from 'lucide-react';
import * as api from '../../../services/api';
import { useGitStore, selectBranches } from '../store';
import { runWithToast } from '../runWithToast';
import { useToastStore } from '../../../stores/toastStore';

interface GitBranchesViewProps {
  projectId: string;
  worktreePath: string;
  onAfterMutation?: () => void | Promise<void>;
}

export function GitBranchesView({ projectId, worktreePath, onAfterMutation }: GitBranchesViewProps) {
  const branches = useGitStore(selectBranches(projectId, worktreePath));
  const setBranches = useGitStore((s) => s.setBranches);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.getGitBranches(projectId, worktreePath);
      setBranches(projectId, worktreePath, next);
    } finally {
      setLoading(false);
    }
  }, [projectId, worktreePath, setBranches]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const afterChange = useCallback(async () => {
    await refresh();
    if (onAfterMutation) await onAfterMutation();
  }, [refresh, onAfterMutation]);

  const switchTo = useCallback(async (name: string) => {
    if (busy) return;
    // Warn if the worktree has uncommitted changes a checkout could disrupt.
    try {
      const status = await api.getGitStatus(projectId, worktreePath);
      if (status.staged.length > 0 || status.unstaged.length > 0) {
        const ok = window.confirm(
          `This worktree has uncommitted changes. Switching to "${name}" may fail or carry them over. Continue?`,
        );
        if (!ok) return;
      }
    } catch {
      // If the status check fails, proceed and let git surface any error.
    }
    setBusy(true);
    const result = await runWithToast(`Switch to ${name}`, projectId, () => api.checkoutGitBranch(projectId, worktreePath, name));
    setBusy(false);
    if (result !== null) await afterChange();
  }, [busy, projectId, worktreePath, afterChange]);

  const createBranch = useCallback(async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    const result = await runWithToast(
      `Create ${name}`,
      projectId,
      () => api.createGitBranch(projectId, worktreePath, name, { checkout: true }),
    );
    setBusy(false);
    if (result !== null) {
      setNewName('');
      await afterChange();
    }
  }, [newName, busy, projectId, worktreePath, afterChange]);

  const deleteBranch = useCallback(async (name: string) => {
    if (busy) return;
    if (!window.confirm(`Delete branch "${name}"?`)) return;
    setBusy(true);
    let mutated = false;
    try {
      await api.deleteGitBranch(projectId, worktreePath, name, false);
      mutated = true;
      useToastStore.getState().add({ title: `Deleted ${name}`, type: 'success', projectId, icon: 'system' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/not fully merged/i.test(message)) {
        if (window.confirm(`"${name}" is not fully merged. Force delete?`)) {
          const r = await runWithToast(
            `Force delete ${name}`,
            projectId,
            () => api.deleteGitBranch(projectId, worktreePath, name, true),
          );
          if (r !== null) mutated = true;
        }
      } else {
        useToastStore.getState().add({ title: `Delete ${name} failed`, message, type: 'error', projectId, icon: 'error' });
      }
    } finally {
      setBusy(false);
      if (mutated) await afterChange();
    }
  }, [busy, projectId, worktreePath, afterChange]);

  const local = branches?.filter((b) => !b.isRemote) ?? [];
  const remote = branches?.filter((b) => b.isRemote) ?? [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Branches</span>
        <button
          type="button"
          onClick={() => refresh()}
          disabled={loading}
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* New branch */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') createBranch(); }}
          placeholder="New branch name"
          className="min-w-0 flex-1 bg-background border border-border rounded px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={() => createBranch()}
          disabled={!newName.trim() || busy}
          className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
        >
          <Plus className="w-3 h-3" /> Create
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {!branches ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : (
          <>
            <BranchSection title="Local" branches={local} busy={busy} onSwitch={switchTo} onDelete={deleteBranch} />
            <BranchSection title="Remote" branches={remote} busy={busy} />
          </>
        )}
      </div>
    </div>
  );
}

function BranchSection({
  title,
  branches,
  busy,
  onSwitch,
  onDelete,
}: {
  title: string;
  branches: Array<{ name: string; isCurrent: boolean; upstream?: string }>;
  busy: boolean;
  onSwitch?: (name: string) => void;
  onDelete?: (name: string) => void;
}) {
  if (branches.length === 0) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
        {title} ({branches.length})
      </div>
      <div className="bg-card border border-border rounded divide-y divide-border">
        {branches.map((b) => (
          <div key={b.name} className="flex items-center justify-between px-2 py-1.5 group">
            <button
              type="button"
              disabled={busy || b.isCurrent || !onSwitch}
              onClick={() => onSwitch?.(b.name)}
              className="flex items-center gap-1.5 min-w-0 text-left disabled:cursor-default"
              title={b.isCurrent ? 'Current branch' : onSwitch ? `Switch to ${b.name}` : undefined}
            >
              <BranchIcon className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <span className={`text-xs truncate ${b.isCurrent ? 'font-semibold text-primary' : ''}`}>{b.name}</span>
              {b.isCurrent && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-muted/60 text-primary flex-shrink-0">current</span>
              )}
            </button>
            <div className="flex items-center gap-1.5 ml-2">
              {b.upstream && (
                <span className="text-[10px] text-muted-foreground font-mono truncate" title={b.upstream}>
                  {b.upstream}
                </span>
              )}
              {onDelete && !b.isCurrent && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDelete(b.name)}
                  className="p-0.5 rounded text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 disabled:opacity-50"
                  title={`Delete ${b.name}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
