import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronRight, GitCommit, Loader2, Minus, Plus, Sparkles } from 'lucide-react';
import * as api from '../../../services/api';
import type { GitFileDiffKind } from '../../../services/api/git';
import { CodeViewer } from '../../../components/renderers/CodeViewer';
import { useGitStore, selectStatus } from '../store';
import { runWithToast } from '../runWithToast';
import { useExternalRefresh } from '../useExternalRefresh';

interface GitStatusViewProps {
  projectId: string;
  worktreePath: string;
  refreshNonce?: number;
}

export function GitStatusView({ projectId, worktreePath, refreshNonce }: GitStatusViewProps) {
  const status = useGitStore(selectStatus(projectId, worktreePath));
  const setStatus = useGitStore(s => s.setStatus);
  const [committing, setCommitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState('');
  const [expandedDiff, setExpandedDiff] = useState<{ file: string; kind: GitFileDiffKind } | null>(
    null
  );
  const [diffs, setDiffs] = useState<
    Record<string, { loading: boolean; diff?: string; error?: string }>
  >({});

  const diffKey = (file: string, kind: GitFileDiffKind) => `${kind}:${file}`;
  const clearDiffs = () => {
    setExpandedDiff(null);
    setDiffs({});
  };

  const refresh = useCallback(async () => {
    const next = await api.getWorktreeStatus(projectId, worktreePath);
    setStatus(projectId, worktreePath, next);
  }, [projectId, worktreePath, setStatus]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  useExternalRefresh(refresh, refreshNonce);

  const stage = async (files: string[]) => {
    const ok = await runWithToast(`Stage ${files.length} file(s)`, projectId, () =>
      api.stageGitFiles(projectId, worktreePath, files)
    );
    if (ok !== null) {
      clearDiffs();
      await refresh();
    }
  };

  const unstage = async (files: string[]) => {
    const ok = await runWithToast(`Unstage ${files.length} file(s)`, projectId, () =>
      api.unstageGitFiles(projectId, worktreePath, files)
    );
    if (ok !== null) {
      clearDiffs();
      await refresh();
    }
  };

  const commit = async () => {
    const msg = message.trim();
    if (!msg || committing) return;
    setCommitting(true);
    const ok = await runWithToast('Commit', projectId, () =>
      api.commitGit(projectId, worktreePath, msg)
    );
    setCommitting(false);
    if (ok) {
      setMessage('');
      clearDiffs();
      await refresh();
    }
  };

  const generate = async () => {
    if (generating || !status || status.staged.length === 0) return;
    setGenerating(true);
    const result = await runWithToast('Generate commit message', projectId, () =>
      api.generateCommitMessage(projectId, worktreePath)
    );
    setGenerating(false);
    if (result) setMessage(result.message);
  };

  const toggleDiff = async (file: string, kind: GitFileDiffKind) => {
    const key = diffKey(file, kind);
    if (expandedDiff?.file === file && expandedDiff.kind === kind) {
      setExpandedDiff(null);
      return;
    }

    setExpandedDiff({ file, kind });
    if (diffs[key]?.diff || diffs[key]?.loading) return;

    setDiffs(prev => ({ ...prev, [key]: { loading: true } }));
    try {
      const result = await api.getGitFileDiff(projectId, worktreePath, file, kind);
      setDiffs(prev => ({ ...prev, [key]: { loading: false, diff: result.diff } }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load diff';
      setDiffs(prev => ({ ...prev, [key]: { loading: false, error: message } }));
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {!status ? (
          <div className="p-3 text-xs text-muted-foreground">Loading…</div>
        ) : status.clean ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/60">
              <GitCommit className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} />
            </div>
            <p className="text-sm font-medium text-foreground">Working tree clean</p>
            <p className="text-xs text-muted-foreground">No changes to commit.</p>
          </div>
        ) : (
          <div className="p-3 space-y-4">
            <FileSection
              title="Staged"
              files={status.staged}
              diffKind="staged"
              action="unstage"
              onItem={f => unstage([f])}
              onAll={status.staged.length ? () => unstage(status.staged) : undefined}
              expandedDiff={expandedDiff}
              diffs={diffs}
              onToggleDiff={toggleDiff}
            />
            <FileSection
              title="Unstaged"
              files={status.unstaged}
              diffKind="unstaged"
              action="stage"
              onItem={f => stage([f])}
              onAll={status.unstaged.length ? () => stage(status.unstaged) : undefined}
              expandedDiff={expandedDiff}
              diffs={diffs}
              onToggleDiff={toggleDiff}
            />
            <FileSection
              title="Untracked"
              files={status.untracked}
              diffKind="untracked"
              action="stage"
              onItem={f => stage([f])}
              onAll={status.untracked.length ? () => stage(status.untracked) : undefined}
              expandedDiff={expandedDiff}
              diffs={diffs}
              onToggleDiff={toggleDiff}
            />
          </div>
        )}
      </div>

      <div className="border-t border-border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground">Commit message</span>
          <button
            type="button"
            onClick={generate}
            disabled={generating || !status || status.staged.length === 0}
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors hover:bg-muted/60 disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              status && status.staged.length === 0
                ? 'Stage files to generate a message'
                : 'Generate commit message'
            }
          >
            {generating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </div>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Commit message…"
          rows={2}
          className="w-full text-xs px-2 py-1.5 rounded-lg bg-background border border-border focus:border-primary outline-none resize-none"
        />
        <button
          type="button"
          onClick={commit}
          disabled={committing || !message.trim() || !status || status.staged.length === 0}
          className="w-full text-xs py-1.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          title={status && status.staged.length === 0 ? 'Stage files first' : 'git commit -m'}
        >
          <Check className="w-3 h-3" />
          {committing
            ? 'Committing…'
            : !status || status.staged.length === 0
              ? 'Stage files to commit'
              : !message.trim()
                ? 'Enter a commit message'
                : 'Commit Staged'}
        </button>
      </div>
    </div>
  );
}

function FileSection({
  title,
  files,
  diffKind,
  action,
  onItem,
  onAll,
  expandedDiff,
  diffs,
  onToggleDiff,
}: {
  title: string;
  files: string[];
  diffKind: GitFileDiffKind;
  action: 'stage' | 'unstage';
  onItem: (file: string) => void;
  onAll?: () => void;
  expandedDiff: { file: string; kind: GitFileDiffKind } | null;
  diffs: Record<string, { loading: boolean; diff?: string; error?: string }>;
  onToggleDiff: (file: string, kind: GitFileDiffKind) => void;
}) {
  if (files.length === 0) return null;
  const Icon = action === 'stage' ? Plus : Minus;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-foreground">
          {title} <span className="text-muted-foreground">({files.length})</span>
        </span>
        {onAll && (
          <button
            type="button"
            onClick={onAll}
            className="rounded-md px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors hover:bg-muted/60"
          >
            {action} all
          </button>
        )}
      </div>
      <div className="bg-secondary/30 border border-border rounded-lg divide-y divide-border overflow-hidden">
        {files.map(file => {
          const key = `${diffKind}:${file}`;
          const isExpanded = expandedDiff?.file === file && expandedDiff.kind === diffKind;
          const diffState = diffs[key];
          return (
            <div key={file}>
              <div className="flex items-center justify-between px-2 py-1 group">
                <button
                  type="button"
                  onClick={() => onToggleDiff(file, diffKind)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  title="Show diff"
                >
                  <ChevronRight
                    className={`h-3 w-3 flex-shrink-0 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  />
                  <span className="text-xs truncate" title={file}>
                    {file}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={event => {
                    event.stopPropagation();
                    onItem(file);
                  }}
                  className="rounded-md p-1 text-muted-foreground opacity-0 transition-colors hover:bg-secondary hover:text-foreground group-hover:opacity-100"
                  title={action}
                >
                  <Icon className="w-3 h-3" />
                </button>
              </div>
              {isExpanded && (
                <div className="border-t border-border/60 bg-background/60 p-2">
                  {diffState?.loading ? (
                    <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading diff…
                    </div>
                  ) : diffState?.error ? (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-2 text-xs text-destructive">
                      {diffState.error}
                    </div>
                  ) : diffState?.diff ? (
                    <CodeViewer
                      content={diffState.diff}
                      filePath={file}
                      language="diff"
                      maxLines={80}
                      showLineNumbers={false}
                    />
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
