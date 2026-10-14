import { useCallback, useEffect, useRef } from 'react';
import {
  useClaudiaStore,
  type ClaudiaBackendSlice,
  type ClaudiaFeedMessage,
  type ClaudiaRunInstance,
} from '../../stores/claudiaStore';
import { fetchApiForBackend } from '../../services/api/base';
import type { Message } from '@zclaudia/shared/core/message';

/**
 * Claudia transcript reads: standard session/message projection with 4s
 * polling, per-key read versions (a slow stale response must never overwrite a
 * fresh one), recovery of runs whose socket events were lost, and an
 * immediate refetch whenever a run settles.
 */
export function useClaudiaTranscriptSync({
  isConnected,
  activeBackendId,
  threadSessionId,
  slice,
  store,
  threadRuns,
}: {
  isConnected: boolean;
  activeBackendId: string | null;
  threadSessionId: string | null;
  slice: ClaudiaBackendSlice | undefined;
  store: typeof useClaudiaStore;
  threadRuns: ClaudiaRunInstance[];
}) {
  const messages = threadSessionId ? (slice?.messagesBySession[threadSessionId] ?? null) : null;
  const readVersions = useRef(new Map<string, number>());
  const refetchThreadMessages = useCallback(
    async (sessionId: string, backendId: string) => {
      const key = `${backendId}:${sessionId}`;
      const version = (readVersions.current.get(key) ?? 0) + 1;
      readVersions.current.set(key, version);
      const requestedAt = Date.now();
      try {
        const res = await fetchApiForBackend<{
          messages: Array<Message>;
          lastRunStatus?: string | null;
          activeRun?: {
            runId: string;
            content?: string;
            assistantMessageId?: string;
            startedAt?: number;
            seq?: number;
          } | null;
        }>(`/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=100`, backendId);
        if (readVersions.current.get(key) !== version || !res.success || !res.data) return;
        const projected: ClaudiaFeedMessage[] = res.data.messages.map(m => ({
          id: m.id,
          role: m.role === 'user' || m.role === 'assistant' ? m.role : 'other',
          text: typeof m.content === 'string' ? m.content : '',
          createdAt: m.createdAt,
        }));
        // Keep loaded older history; stable IDs replace snapshots rather than duplicate text.
        const previous = store.getState().slices[backendId]?.messagesBySession[sessionId] ?? [];
        const merged = new Map(previous.map(m => [m.id, m]));
        for (const message of projected) merged.set(message.id, message);
        store.getState().setSessionMessages(
          backendId,
          sessionId,
          [...merged.values()].sort((a, b) => a.createdAt - b.createdAt)
        );
        const live = res.data.activeRun;
        const current = store.getState().slices[backendId];
        if (live) {
          const known = current?.runs.find(run => run.runId === live.runId);
          if (!known) {
            const thread = Object.values(current?.threadsByProject ?? {})
              .flat()
              .find(t => t.session?.id === sessionId);
            if (thread)
              store.getState().startRun(backendId, {
                clientRequestId: `recovered:${live.runId}`,
                input: '',
                projectId: thread.projectId,
                threadId: thread.id,
                sessionId,
                runId: live.runId,
                status: 'running',
                assistantMessageId: live.assistantMessageId,
                agentProfileId: thread.session?.agentProfileId ?? undefined,
                responseText: live.content,
                createdAt: live.startedAt ?? requestedAt,
                updatedAt: requestedAt,
              });
          }
          if (live.content !== undefined)
            store.getState().applyRunSnapshot(backendId, live.runId, live.content, live.seq);
        }
        // A terminal event may have been lost while the socket was disconnected.
        // Refresh the authoritative thread/session state before settling the local projection.
        const stale =
          current?.runs.filter(
            run =>
              run.sessionId === sessionId &&
              run.status === 'running' &&
              run.runId !== live?.runId &&
              run.updatedAt <= requestedAt
          ) ?? [];
        for (const run of stale) {
          if (!run.threadId) continue;
          const latest = store
            .getState()
            .slices[backendId]?.runs.find(r => r.clientRequestId === run.clientRequestId);
          if (!latest || latest.status !== 'running' || latest.updatedAt > requestedAt) continue;
          const status = res.data.lastRunStatus;
          const finalStatus =
            status === 'failed' || status === 'cancelled' || status === 'interrupted'
              ? status
              : 'completed';
          store
            .getState()
            .startRun(backendId, { ...latest, status: finalStatus, updatedAt: Date.now() });
        }
      } catch {
        store.getState().setSessionMessagesLoading(backendId, sessionId, false);
      }
    },
    [store]
  );

  useEffect(() => {
    if (!isConnected || !activeBackendId || !threadSessionId) return;
    let stopped = false;
    const versions = readVersions.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      await refetchThreadMessages(threadSessionId, activeBackendId);
      if (!stopped) timer = setTimeout(refresh, 4000);
    };
    void refresh();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      const key = `${activeBackendId}:${threadSessionId}`;
      versions.set(key, (versions.get(key) ?? 0) + 1);
    };
  }, [isConnected, activeBackendId, threadSessionId, refetchThreadMessages]);

  const settledRunKey = threadRuns
    .filter(run => !['running', 'submitting', 'rejected'].includes(run.status))
    .map(run => `${run.clientRequestId}:${run.status}`)
    .join('|');
  useEffect(() => {
    if (isConnected && activeBackendId && threadSessionId && settledRunKey) {
      void refetchThreadMessages(threadSessionId, activeBackendId);
    }
  }, [settledRunKey, isConnected, activeBackendId, threadSessionId, refetchThreadMessages]);

  return { messages };
}
