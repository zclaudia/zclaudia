import { useState } from 'react';
import { Download, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import * as api from '../../../services/api';
import { runWithToast } from '../runWithToast';

interface SyncButtonsProps {
  projectId: string;
  worktreePath: string;
  ahead?: number;
  behind?: number;
  onAfter?: () => void | Promise<void>;
}

function Count({ n }: { n: number }) {
  return (
    <span className="ml-0.5 rounded bg-muted/70 px-1 text-[10px] leading-none text-foreground tabular-nums">
      {n}
    </span>
  );
}

export function SyncButtons({
  projectId,
  worktreePath,
  ahead = 0,
  behind = 0,
  onAfter,
}: SyncButtonsProps) {
  const [busy, setBusy] = useState<null | 'fetch' | 'pull' | 'push'>(null);

  const run = async (kind: 'fetch' | 'pull' | 'push') => {
    if (busy) return;
    setBusy(kind);
    const label = kind === 'fetch' ? 'Fetch' : kind === 'pull' ? 'Pull' : 'Push';
    const fn =
      kind === 'fetch'
        ? () => api.fetchGit(projectId, worktreePath)
        : kind === 'pull'
          ? () => api.pullGit(projectId, worktreePath)
          : () => api.pushGit(projectId, worktreePath);
    await runWithToast(label, projectId, fn);
    setBusy(null);
    if (onAfter) await onAfter();
  };

  const baseBtn =
    'inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground shadow-apple-sm transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-50';

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => run('fetch')}
        disabled={!!busy}
        className={baseBtn}
        title="git fetch origin"
      >
        <Download className="w-3 h-3 opacity-70" />
        {busy === 'fetch' ? 'Fetching…' : 'Fetch'}
      </button>
      <button
        type="button"
        onClick={() => run('pull')}
        disabled={!!busy}
        className={baseBtn}
        title={behind > 0 ? `git pull --ff-only (${behind} behind)` : 'git pull --ff-only'}
      >
        <ArrowDownToLine className="w-3 h-3 opacity-70" />
        {busy === 'pull' ? 'Pulling…' : 'Pull'}
        {behind > 0 && busy !== 'pull' && <Count n={behind} />}
      </button>
      <button
        type="button"
        onClick={() => run('push')}
        disabled={!!busy}
        className={baseBtn}
        title={ahead > 0 ? `git push (${ahead} ahead)` : 'git push'}
      >
        <ArrowUpFromLine className="w-3 h-3 opacity-70" />
        {busy === 'push' ? 'Pushing…' : 'Push'}
        {ahead > 0 && busy !== 'push' && <Count n={ahead} />}
      </button>
    </div>
  );
}
