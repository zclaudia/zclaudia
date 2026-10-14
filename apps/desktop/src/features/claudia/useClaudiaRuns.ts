import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useClaudiaStore,
  type ClaudiaBackendSlice,
  type ClaudiaRunInstance,
  type ClaudiaThreadSummary,
} from '../../stores/claudiaStore';
import { fetchApiForBackend } from '../../services/api/base';
import type { ClientMessage } from '@zclaudia/shared/wire/messages/index';

/**
 * Claudia run instances: thread-scoped run projections, replay of requests
 * still stuck in `submitting` after a reconnect, and interrupted-run recovery
 * (resume + dismiss) keyed by the thread's session.
 */
export function useClaudiaRuns({
  isConnected,
  activeBackendId,
  selectedProjectId,
  slice,
  store,
  currentThread,
  activeThreadId,
  threadSessionId,
  wsSendMessage,
  resumeSend,
}: {
  isConnected: boolean;
  activeBackendId: string | null;
  selectedProjectId: string | null;
  slice: ClaudiaBackendSlice | undefined;
  store: typeof useClaudiaStore;
  currentThread: ClaudiaThreadSummary | null;
  activeThreadId: string | null;
  threadSessionId: string | null;
  wsSendMessage: (message: ClientMessage) => void;
  /** Sends 'continue' into the current thread and disarms the new-topic interlock. */
  resumeSend: () => void;
}) {
  const runs = useMemo(() => slice?.runs ?? [], [slice?.runs]);
  const projectRuns = useMemo(
    () => runs.filter(run => !selectedProjectId || run.projectId === selectedProjectId),
    [runs, selectedProjectId]
  );
  const threadRuns = useMemo(
    () =>
      projectRuns
        .filter(run => {
          const target = currentThread?.id ?? activeThreadId;
          return target
            ? run.threadId === target ||
                (run.status === 'submitting' && run.originThreadId === target)
            : !run.threadId;
        })
        .sort((a, b) => a.createdAt - b.createdAt),
    [projectRuns, currentThread, activeThreadId]
  );
  const activeRun: ClaudiaRunInstance | null =
    threadRuns.find(run => run.status === 'running' || run.status === 'submitting') ??
    threadRuns.filter(run => run.status !== 'rejected').slice(-1)[0] ??
    null;
  const rejectedRuns = threadRuns.filter(run => run.status === 'rejected');

  useEffect(() => {
    if (!isConnected || !activeBackendId) return;
    // A lost accepted receipt must replay the same request, never allocate a
    // fresh request ID. The server ledger reconciles accepted/rejected/uncertain.
    for (const pending of store.getState().slices[activeBackendId]?.runs ?? []) {
      if (pending.status === 'submitting' && pending.request) wsSendMessage(pending.request);
    }
  }, [isConnected, activeBackendId, wsSendMessage, store]);

  // --- Interrupted recovery, keyed by the thread's session ---
  const [dismissedInterruption, setDismissedInterruption] = useState('');
  const interruptionKey = `${activeBackendId}:${threadSessionId}:${activeRun?.clientRequestId ?? currentThread?.session?.updatedAt}`;
  const threadInterrupted =
    dismissedInterruption !== interruptionKey &&
    (activeRun
      ? activeRun.status === 'interrupted'
      : currentThread?.session?.lastRunStatus === 'interrupted');

  const handleResumeInterrupted = useCallback(async () => {
    if (!threadSessionId || !activeBackendId) return;
    try {
      const response = await fetchApiForBackend(
        `/api/sessions/${encodeURIComponent(threadSessionId)}/dismiss-interrupted`,
        activeBackendId,
        { method: 'PATCH' }
      );
      if (!response.success) return;
    } catch (error) {
      console.warn('[ClaudiaChat] Failed to clear interrupted status before resume:', error);
      return;
    }
    resumeSend();
    setDismissedInterruption(interruptionKey);
    // Refresh thread run status
    if (selectedProjectId) {
      fetchApiForBackend<{ threads: ClaudiaThreadSummary[] }>(
        `/api/claudia/threads?projectId=${encodeURIComponent(selectedProjectId)}`,
        activeBackendId
      )
        .then(res => {
          if (res.success && res.data?.threads) {
            store.getState().setThreads(activeBackendId, selectedProjectId, res.data.threads);
          }
        })
        .catch(() => {});
    }
  }, [threadSessionId, activeBackendId, selectedProjectId, resumeSend, store, interruptionKey]);

  const handleDismissInterrupted = useCallback(async () => {
    if (!threadSessionId) return;
    try {
      const response = await fetchApiForBackend(
        `/api/sessions/${encodeURIComponent(threadSessionId)}/dismiss-interrupted`,
        activeBackendId,
        { method: 'PATCH' }
      );
      if (!response.success) return;
    } catch (error) {
      console.warn('[ClaudiaChat] Failed to dismiss interrupted status:', error);
      return;
    }
    setDismissedInterruption(interruptionKey);
    if (activeBackendId && selectedProjectId) {
      const next = (slice?.threadsByProject[selectedProjectId] ?? []).map(thread =>
        thread.session?.id === threadSessionId && thread.session
          ? { ...thread, session: { ...thread.session, lastRunStatus: null } }
          : thread
      );
      store.getState().setThreads(activeBackendId, selectedProjectId, next);
    }
  }, [
    threadSessionId,
    activeBackendId,
    selectedProjectId,
    slice?.threadsByProject,
    store,
    interruptionKey,
  ]);

  return {
    runs,
    threadRuns,
    activeRun,
    rejectedRuns,
    threadInterrupted,
    handleResumeInterrupted,
    handleDismissInterrupted,
  };
}
