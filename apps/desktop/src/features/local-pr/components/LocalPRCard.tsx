import type { LocalPR, LocalPRStatus, ExecutionState, LlmProfileConfig } from '@zclaudia/shared';
import {
  GitMerge,
  XCircle,
  ChevronDown,
  ChevronUp,
  Eye,
  MessageSquare,
  FileCode,
  Bot,
  RotateCcw,
  Undo2,
  Clock,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '../../../components/ui/Button';
import { useLocalPRStore } from '../store';
import { useProjectStore } from '../../../stores/projectStore';
import { useLlmProfileMetaStore } from '../../../stores/llmProfileMetaStore';
import { useServerStore } from '../../../stores/serverStore';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import * as api from '../../../services/api';
import { cancelLocalPRQueue, retryLocalPR } from '../api';
import { DiffViewerModal } from './DiffViewerModal';

// Status → semantic theme tokens (label carries the exact state, color the
// category). Raw `-500` palette on its own `/10` tint failed WCAG AA in light
// mode and never re-tuned per theme.
const STATUS_CONFIG: Record<LocalPRStatus, { label: string; color: string }> = {
  open: { label: 'Open', color: 'bg-primary/10 text-primary' },
  reviewing: { label: 'Reviewing', color: 'bg-warning/10 text-warning' },
  review_failed: { label: 'Review Failed', color: 'bg-destructive/10 text-destructive' },
  approved: { label: 'Approved', color: 'bg-success/10 text-success' },
  merging: { label: 'Merging', color: 'bg-primary/10 text-primary' },
  merged: { label: 'Merged', color: 'bg-success/10 text-success' },
  conflict: { label: 'Conflict', color: 'bg-warning/10 text-warning' },
  closed: { label: 'Closed', color: 'bg-muted text-muted-foreground' },
};

const EXECUTION_STATE_CONFIG: Record<
  ExecutionState,
  { label: string; color: string; icon: React.ReactNode }
> = {
  idle: { label: 'Idle', color: '', icon: null },
  queued: {
    label: 'Queued',
    color: 'bg-warning/10 text-warning',
    icon: <Clock className="w-3 h-3" />,
  },
  running: {
    label: 'Running',
    color: 'bg-primary/10 text-primary',
    icon: <Loader2 className="w-3 h-3 animate-spin" />,
  },
  failed: {
    label: 'Failed',
    color: 'bg-destructive/10 text-destructive',
    icon: <AlertCircle className="w-3 h-3" />,
  },
};

interface LocalPRCardProps {
  pr: LocalPR;
  projectId: string;
}

export function LocalPRCard({ pr, projectId }: LocalPRCardProps) {
  const isMobile = useIsMobile();
  const [diffOpen, setDiffOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewPickerOpen, setReviewPickerOpen] = useState(false);
  const { closePR, reviewPR, mergePR, cancelMergePR, resolveConflictPR, reopenPR, revertMergedPR } =
    useLocalPRStore();
  const activeServerId = useServerStore(s => s.activeServerId);
  const legacyProviders = useProjectStore(s => s.providers);
  const scopedProviders = useLlmProfileMetaStore(s => s.getProviders(activeServerId));
  const providers = scopedProviders.length > 0 ? scopedProviders : legacyProviders;
  const projects = useProjectStore(s => s.projects);
  const sessions = useProjectStore(s => s.sessions);
  const selectSession = useProjectStore(s => s.selectSession);
  const status = STATUS_CONFIG[pr.status] ?? {
    label: pr.status,
    color: 'bg-muted text-muted-foreground',
  };
  const executionState = EXECUTION_STATE_CONFIG[pr.executionState] ?? EXECUTION_STATE_CONFIG.idle;
  const showExecutionState = pr.executionState !== 'idle';

  const project = projects.find(p => p.id === projectId);
  // NOTE: prior to sub-project C this fell back to `project.llmProfileId`. That field
  // has been replaced by `project.defaultAgentProfileId`, which points at an
  // agent profile, not an LLM profile. The agent → llm resolution is now done
  // server-side by the review pipeline; the UI only forwards the explicit
  // `reviewLlmProfileId` override (if any).
  const defaultLlmProfileId = project?.reviewLlmProfileId || '';

  const branchShort = pr.branchName.replace(/^(feat|fix|chore|refactor)\//, '');
  const commitCount = pr.commits?.length ?? 0;
  const date = new Date(pr.createdAt).toLocaleDateString();

  const handleClose = async () => {
    setActionError(null);
    setLoading(true);
    try {
      await closePR(pr.id, projectId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to close PR');
    } finally {
      setLoading(false);
    }
  };

  const handleMerge = async () => {
    setActionError(null);
    setLoading(true);
    try {
      await mergePR(pr.id, projectId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to merge PR');
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async (llmProfileId?: string) => {
    setReviewPickerOpen(false);
    setActionError(null);
    setLoading(true);
    try {
      await reviewPR(pr.id, projectId, llmProfileId || undefined);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to start review');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelMerge = async () => {
    setActionError(null);
    setLoading(true);
    try {
      await cancelMergePR(pr.id, projectId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to cancel merge');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelAndRetryMerge = async () => {
    setActionError(null);
    setLoading(true);
    try {
      await cancelMergePR(pr.id, projectId);
      await mergePR(pr.id, projectId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to retry merge');
    } finally {
      setLoading(false);
    }
  };

  const handleResolveConflictWithAI = async () => {
    setActionError(null);
    setLoading(true);
    try {
      await resolveConflictPR(pr.id, projectId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to start AI conflict resolution');
    } finally {
      setLoading(false);
    }
  };

  const handleReopen = async () => {
    setActionError(null);
    setLoading(true);
    try {
      await reopenPR(pr.id, projectId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to reopen PR');
    } finally {
      setLoading(false);
    }
  };

  const handleRevertMerged = async () => {
    setActionError(null);
    setLoading(true);
    try {
      await revertMergedPR(pr.id, projectId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to revert merged PR');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelQueue = async () => {
    setActionError(null);
    setLoading(true);
    try {
      await cancelLocalPRQueue(pr.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to cancel queue');
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async () => {
    setActionError(null);
    setLoading(true);
    try {
      await retryLocalPR(pr.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to retry');
    } finally {
      setLoading(false);
    }
  };

  const canReview = pr.status === 'open' || pr.status === 'review_failed';
  const openSession = async (sessionId: string) => {
    useProjectStore.getState().setDashboardView(projectId, 'local-prs');
    // If session isn't in store yet (broadcast missed), refresh from server
    if (!sessions.find(s => s.id === sessionId)) {
      const fresh = await api.getSessions(projectId);
      useProjectStore.getState().mergeSessions(fresh);
    }
    // Session may have been permanently deleted
    if (!useProjectStore.getState().sessions.find(s => s.id === sessionId)) return;
    selectSession(sessionId);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${status.color}`}>
              {status.label}
            </span>
            {showExecutionState && (
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${executionState.color}`}
              >
                {executionState.icon}
                {executionState.label}
              </span>
            )}
            {pr.autoTriggered && (
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md">
                auto
              </span>
            )}
            {pr.autoReview && (
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md">
                auto-review
              </span>
            )}
          </div>
          <p className="text-sm font-medium mt-1 truncate" title={pr.title}>
            {pr.title}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            <code className="bg-muted px-1 rounded-md">{branchShort}</code>
            {' → '}
            <code className="bg-muted px-1 rounded-md">{pr.baseBranch}</code>
            {' · '}
            {commitCount} commit{commitCount !== 1 ? 's' : ''}
            {' · '}
            {date}
          </p>
        </div>

        {!isMobile && (
          <div className="flex items-center gap-1 shrink-0">
            {pr.executionState === 'queued' && (
              <IconButton
                size="sm"
                aria-label="Cancel queue"
                onClick={handleCancelQueue}
                disabled={loading}
                title="Cancel queue"
              >
                <XCircle className="w-3.5 h-3.5" />
              </IconButton>
            )}
            {pr.executionState === 'failed' && (
              <IconButton
                size="sm"
                aria-label="Retry"
                onClick={handleRetry}
                disabled={loading}
                title="Retry"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </IconButton>
            )}
            {canReview && (
              <div className="relative">
                <IconButton
                  size="sm"
                  aria-label="AI Review"
                  onClick={() => setReviewPickerOpen(v => !v)}
                  disabled={loading}
                  title="AI Review"
                >
                  <Eye className="w-3.5 h-3.5" />
                </IconButton>
                {reviewPickerOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setReviewPickerOpen(false)}
                    />
                    <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-xl shadow-lg p-2 min-w-[200px]">
                      <p className="text-xs font-medium text-muted-foreground mb-1.5 px-1">
                        Review with:
                      </p>
                      <button
                        onClick={() => handleReview(defaultLlmProfileId)}
                        className="w-full text-left text-xs px-2 py-1.5 rounded-md hover:bg-muted"
                      >
                        Default
                        {defaultLlmProfileId
                          ? ` (${getProviderLabel(providers, defaultLlmProfileId)})`
                          : ''}
                      </button>
                      {providers
                        .filter(p => p.id !== defaultLlmProfileId)
                        .map(p => (
                          <button
                            key={p.id}
                            onClick={() => handleReview(p.id)}
                            className="w-full text-left text-xs px-2 py-1.5 rounded-md hover:bg-muted"
                          >
                            {p.name} ({p.providerType})
                          </button>
                        ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {pr.status === 'open' && (
              <IconButton
                size="sm"
                aria-label="Merge directly (skip review)"
                onClick={handleMerge}
                disabled={loading}
                title="Merge directly (skip review)"
              >
                <GitMerge className="w-3.5 h-3.5" />
              </IconButton>
            )}
            {pr.status === 'approved' && (
              <IconButton
                size="sm"
                aria-label="Merge now"
                onClick={handleMerge}
                disabled={loading}
                title="Merge now"
              >
                <GitMerge className="w-3.5 h-3.5" />
              </IconButton>
            )}
            {pr.status === 'conflict' && (
              <>
                <IconButton
                  size="sm"
                  aria-label="Retry merge"
                  onClick={handleMerge}
                  disabled={loading}
                  title="Retry merge"
                >
                  <GitMerge className="w-3.5 h-3.5" />
                </IconButton>
                <IconButton
                  size="sm"
                  aria-label="Resolve with AI"
                  onClick={handleResolveConflictWithAI}
                  disabled={loading}
                  title="Resolve with AI"
                >
                  <Bot className="w-3.5 h-3.5" />
                </IconButton>
              </>
            )}
            {pr.status === 'merging' && (
              <>
                <IconButton
                  size="sm"
                  aria-label="Cancel merge"
                  onClick={handleCancelMerge}
                  disabled={loading}
                  title="Cancel merge"
                >
                  <XCircle className="w-3.5 h-3.5" />
                </IconButton>
                <IconButton
                  size="sm"
                  aria-label="Cancel and retry"
                  onClick={handleCancelAndRetryMerge}
                  disabled={loading}
                  title="Cancel and retry"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </IconButton>
              </>
            )}
            {pr.status === 'merged' && (
              <IconButton
                size="sm"
                aria-label="Revert merge"
                onClick={handleRevertMerged}
                disabled={loading}
                title="Revert merge"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </IconButton>
            )}
            {pr.status === 'closed' && (
              <IconButton
                size="sm"
                aria-label="Reopen PR"
                onClick={handleReopen}
                disabled={loading}
                title="Reopen PR"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </IconButton>
            )}
            {!['merged', 'closed'].includes(pr.status) && (
              <button
                onClick={handleClose}
                disabled={loading}
                title="Close PR"
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                <XCircle className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {isMobile && pr.executionState === 'queued' && (
          <button
            onClick={handleCancelQueue}
            disabled={loading}
            className="text-xs rounded-md border border-border px-2 py-1 hover:bg-muted disabled:opacity-50"
          >
            Cancel Queue
          </button>
        )}
        {isMobile && pr.executionState === 'failed' && (
          <button
            onClick={handleRetry}
            disabled={loading}
            className="text-xs rounded-md border border-border px-2 py-1 hover:bg-muted disabled:opacity-50"
          >
            Retry
          </button>
        )}
        {isMobile && pr.status === 'merging' && (
          <>
            <button
              onClick={handleCancelMerge}
              disabled={loading}
              className="text-xs rounded-md border border-border px-2 py-1 hover:bg-muted disabled:opacity-50"
            >
              Cancel merge
            </button>
            <button
              onClick={handleCancelAndRetryMerge}
              disabled={loading}
              className="text-xs rounded-md border border-border px-2 py-1 hover:bg-muted disabled:opacity-50"
            >
              Cancel + Retry
            </button>
          </>
        )}
        {isMobile && pr.status === 'conflict' && (
          <>
            <button
              onClick={handleMerge}
              disabled={loading}
              className="text-xs rounded-md border border-border px-2 py-1 hover:bg-muted disabled:opacity-50"
            >
              Retry merge
            </button>
            <button
              onClick={handleResolveConflictWithAI}
              disabled={loading}
              className="text-xs rounded-md border border-border px-2 py-1 hover:bg-muted disabled:opacity-50"
            >
              Resolve with AI
            </button>
          </>
        )}
        {isMobile && pr.status === 'merged' && (
          <button
            onClick={handleRevertMerged}
            disabled={loading}
            className="text-xs rounded-md border border-border px-2 py-1 hover:bg-muted disabled:opacity-50"
          >
            Revert merge
          </button>
        )}
        {isMobile && pr.status === 'closed' && (
          <button
            onClick={handleReopen}
            disabled={loading}
            className="text-xs rounded-md border border-border px-2 py-1 hover:bg-muted disabled:opacity-50"
          >
            Reopen
          </button>
        )}
        {!isMobile && pr.diffSummary && (
          <button
            onClick={() => setDiffOpen(true)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <FileCode className="w-3 h-3" />
            View diff
          </button>
        )}
        {pr.reviewSessionId && (
          <button
            onClick={() => openSession(pr.reviewSessionId!)}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"
          >
            <MessageSquare className="w-3 h-3" />
            View review session
          </button>
        )}
        {pr.conflictSessionId && (
          <button
            onClick={() => openSession(pr.conflictSessionId!)}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"
          >
            <MessageSquare className="w-3 h-3" />
            View conflict session
          </button>
        )}
        {pr.reviewNotes && (
          <button
            onClick={() => setNotesOpen(v => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {notesOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Review notes
          </button>
        )}
      </div>

      {diffOpen && pr.diffSummary && (
        <DiffViewerModal
          title={pr.title}
          diff={pr.diffSummary}
          onClose={() => setDiffOpen(false)}
        />
      )}

      {notesOpen && pr.reviewNotes && (
        <pre className="text-xs bg-muted p-2 rounded-md overflow-auto max-h-40 whitespace-pre-wrap">
          {pr.reviewNotes}
        </pre>
      )}

      {pr.statusMessage && <p className="text-xs text-muted-foreground">{pr.statusMessage}</p>}

      {actionError && <p className="text-xs text-destructive">{actionError}</p>}
    </div>
  );
}

function getProviderLabel(providers: LlmProfileConfig[], id: string): string {
  const p = providers.find(p => p.id === id);
  return p ? `${p.name}` : id.slice(0, 8);
}
