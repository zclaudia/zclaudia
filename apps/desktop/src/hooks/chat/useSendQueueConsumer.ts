import { useEffect, useRef } from 'react';
import { isSessionRunActive, useSessionRunStateStore, type SessionRunRecord } from '../../stores/sessionRunStateStore';
import { useSendQueueStore } from '../../stores/sendQueueStore';
import { useToastStore } from '../../stores/toastStore';
import type { Attachment } from '../../features/chat/MessageInput';

interface UseSendQueueConsumerParams {
  sessionId: string;
  /** Ships a queued item as a brand-new run (run_start + optimistic message). */
  sendAsNewRun: (content: string, attachments?: Attachment[]) => Promise<void>;
}

/**
 * Drains a session's send queue whenever its run transitions from active to
 * idle. Items pop one at a time and each becomes its own run_start, so they
 * execute serially: send item → run starts → run ends → send next item.
 *
 * A re-entry lock (`consumingRef`) is held from the moment we decide to ship an
 * item until the run we kicked off registers as active. This closes the race
 * where, between dispatching run_start and the server's `run_started`, the
 * session can still read as idle and a spurious transition would drain again.
 *
 * Scope: client-only, per-session. The session must be mounted (ChatInterface
 * is open) for the queue to drain. Queue items are held in-memory only.
 */
export function useSendQueueConsumer({ sessionId, sendAsNewRun }: UseSendQueueConsumerParams): void {
  // True between "decided to ship an item" and "the shipped run went active".
  const consumingRef = useRef(false);

  // Re-bind latest sendAsNewRun without re-subscribing.
  const sendRef = useRef(sendAsNewRun);
  useEffect(() => {
    sendRef.current = sendAsNewRun;
  }, [sendAsNewRun]);

  useEffect(() => {
    const sessionIsActive = (records: Record<string, SessionRunRecord>): boolean =>
      Object.values(records).some((r) => r.sessionId === sessionId && isSessionRunActive(r));

    const drainOne = async (): Promise<void> => {
      if (consumingRef.current) return;
      const store = useSendQueueStore.getState();
      const items = (store.queues[sessionId] ?? []).filter((i) => i.intent === 'queue');
      if (items.length === 0) return;
      // Re-check idleness right before shipping — a manual run_start (e.g. via
      // resend) may have flipped the session active since the transition fired.
      if (sessionIsActive(useSessionRunStateStore.getState().records)) return;

      consumingRef.current = true; // lock until the new run becomes active
      const item = useSendQueueStore.getState().popFirst(sessionId, 'queue');
      if (!item) {
        consumingRef.current = false;
        return;
      }
      try {
        await sendRef.current(item.content, item.attachments);
        // Lock stays held; the active transition (below) unlocks it so the
        // NEXT idle transition is treated as a fresh, distinct run end.
      } catch (err) {
        console.error('[useSendQueueConsumer] failed to ship queued item:', err);
        useToastStore.getState().add({
          type: 'error',
          title: 'Failed to send queued message',
          message: err instanceof Error ? err.message : 'Please retry manually.',
        });
        consumingRef.current = false;
      }
    };

    const unsubscribe = useSessionRunStateStore.subscribe((state, prev) => {
      const wasActive = sessionIsActive(prev.records);
      const nowActive = sessionIsActive(state.records);

      // A run we kicked off just registered as active → unlock for the next
      // drain cycle (the run's eventual end will fire the idle branch).
      if (nowActive) {
        consumingRef.current = false;
      }

      // Active → idle: a run ended. Try to ship the next queued item.
      if (wasActive && !nowActive) {
        void drainOne();
      }
    });

    // Also drain on mount in case the session is already idle with a backlog
    // (e.g. restored queue + run finished while view was closed).
    if (!sessionIsActive(useSessionRunStateStore.getState().records)) {
      void drainOne();
    }

    return unsubscribe;
  }, [sessionId]);
}
