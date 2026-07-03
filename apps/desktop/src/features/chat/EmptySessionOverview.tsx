import { useEffect, useMemo, type ReactNode } from 'react';
import { GitBranch, FileDiff, Compass, Target } from 'lucide-react';
import type { SlashCommand } from '@zclaudia/shared';
import * as api from '../../services/api';
import { useGitStore, selectStatus, selectLog } from '../git/store';

/** Loads git status + latest commit for the empty-session snapshot/chips.
 * Reuses the git store cache; fetch errors are swallowed (non-git dirs
 * simply never populate the cache and the snapshot stays hidden). */
function useEmptySessionGitInfo(projectId: string | undefined, worktreePath: string | undefined) {
  const status = useGitStore(
    projectId && worktreePath ? selectStatus(projectId, worktreePath) : () => undefined
  );
  const log = useGitStore(
    projectId && worktreePath ? selectLog(projectId, worktreePath) : () => undefined
  );
  const setStatus = useGitStore(s => s.setStatus);
  const setLog = useGitStore(s => s.setLog);

  useEffect(() => {
    if (!projectId || !worktreePath) return;
    let cancelled = false;
    api
      .getWorktreeStatus(projectId, worktreePath)
      .then(next => {
        if (!cancelled) setStatus(projectId, worktreePath, next);
      })
      .catch(() => {});
    api
      .getGitLog(projectId, worktreePath, 1)
      .then(next => {
        if (!cancelled) setLog(projectId, worktreePath, next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, worktreePath, setStatus, setLog]);

  const changeCount = useMemo(() => {
    if (!status) return 0;
    return new Set([...status.staged, ...status.unstaged, ...status.untracked]).size;
  }, [status]);

  return { status, latestCommit: log?.[0], changeCount };
}

interface EmptySessionSnapshotProps {
  projectId: string | undefined;
  projectName: string | undefined;
  worktreePath: string | undefined;
}

/** Frameless two-line project snapshot shown above the centered composer. */
export function EmptySessionSnapshot({
  projectId,
  projectName,
  worktreePath,
}: EmptySessionSnapshotProps) {
  const { status, latestCommit, changeCount } = useEmptySessionGitInfo(projectId, worktreePath);

  if (!status || !projectName) return null;

  return (
    <div className="mb-6 px-1.5 animate-fade-in">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-foreground truncate">{projectName}</span>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground flex-shrink-0">
          <GitBranch size={14} strokeWidth={1.75} />
          <span className="truncate max-w-[200px]">{status.currentBranch}</span>
          {status.ahead > 0 && <span>↑{status.ahead}</span>}
          {status.behind > 0 && <span>↓{status.behind}</span>}
        </span>
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground/60 truncate">
        {status.clean
          ? 'Working tree clean'
          : `${changeCount} uncommitted ${changeCount === 1 ? 'change' : 'changes'}`}
        {latestCommit && (
          <>
            {' · '}
            <span className="font-mono">{latestCommit.shortSha}</span> {latestCommit.message}
          </>
        )}
      </div>
    </div>
  );
}

interface EmptySessionChipsProps {
  projectId: string | undefined;
  worktreePath: string | undefined;
  commands: SlashCommand[];
  onSuggestion: (text: string) => void;
}

/** True when a command list contains the `/goal` slash command. */
function hasGoalCommand(commands: SlashCommand[]): boolean {
  return commands.some(c => c.command === '/goal');
}

/** Suggestion chips shown below the selector row on the empty-session screen. */
export function EmptySessionChips({
  projectId,
  worktreePath,
  commands,
  onSuggestion,
}: EmptySessionChipsProps) {
  const { status } = useEmptySessionGitInfo(projectId, worktreePath);
  const showGoalChip = hasGoalCommand(commands);
  const dirty = !!status && !status.clean;

  const chips: Array<{ key: string; icon: ReactNode; label: string; template: string }> = [];
  if (dirty) {
    chips.push({
      key: 'review',
      icon: <FileDiff size={14} strokeWidth={1.75} />,
      label: 'Review uncommitted changes',
      template: 'Review my uncommitted changes and point out any issues.',
    });
  } else {
    chips.push({
      key: 'explain',
      icon: <Compass size={14} strokeWidth={1.75} />,
      label: 'Explain this codebase',
      template: "Give me an overview of this codebase and how it's organized.",
    });
  }
  if (showGoalChip) {
    chips.push({
      key: 'goal',
      icon: <Target size={14} strokeWidth={1.75} />,
      label: 'Set a goal',
      template: '/goal ',
    });
  }

  return (
    <div className="mt-4 px-1.5 flex flex-wrap items-center gap-1.5">
      {chips.map(chip => (
        <button
          key={chip.key}
          onClick={() => onSuggestion(chip.template)}
          className="h-7 px-2.5 inline-flex items-center gap-1.5 text-sm rounded-md border border-border text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
        >
          {chip.icon}
          {chip.label}
        </button>
      ))}
    </div>
  );
}
