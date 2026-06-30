import { create } from 'zustand';
import type { Attachment } from '../features/chat/MessageInput';

/**
 * Intent of a queued send item.
 * - `'queue'`  (default): held until the current run ends, then auto-sent as a
 *   new `run_start` (serial — one at a time).
 * - `'steer'`: only used transiently when the user clicks "Steer now" on an
 *   item; the item is removed from the queue and sent via `run_steer`
 *   immediately. `sendQueueStore` itself does not keep `'steer'` items around.
 */
export type QueueItemIntent = 'queue' | 'steer';

export interface QueueItem {
  id: string;
  sessionId: string;
  /** Raw message text (same shape as what the input box produces). */
  content: string;
  /** Optional file/image attachments; uploaded + sent when the item ships. */
  attachments: Attachment[];
  intent: QueueItemIntent;
  createdAt: number;
}

interface SendQueueState {
  /** Per-session ordered queue (oldest first). */
  queues: Record<string, QueueItem[]>;

  /** Add an item to the back of a session's queue. */
  enqueue: (item: Omit<QueueItem, 'id' | 'createdAt'>) => void;

  /** Remove a specific item by id. Returns nothing. */
  removeItem: (sessionId: string, itemId: string) => void;

  /** Remove and return the first item matching `intent` for a session. */
  popFirst: (sessionId: string, intent: QueueItemIntent) => QueueItem | undefined;

  /** Replace a session's entire queue (used to fully drain / clear). */
  clearSession: (sessionId: string) => void;
}

function withQueue(
  state: SendQueueState,
  sessionId: string,
  updater: (items: QueueItem[]) => QueueItem[],
): Partial<SendQueueState> {
  const next = updater(state.queues[sessionId] ?? []);
  if (next.length === 0) {
    // Drop the key entirely when empty so selectors see "no queue".
    const { [sessionId]: _, ...rest } = state.queues;
    return { queues: rest };
  }
  return { queues: { ...state.queues, [sessionId]: next } };
}

// Holds messages the user composed while a run was active. They wait here
// (client-only, in-memory) until the run ends, then ship one-by-one as new
// runs. The user may also "Steer now" any item to inject it mid-run.
export const useSendQueueStore = create<SendQueueState>((set) => ({
  queues: {},

  enqueue: (item) =>
    set((state) =>
      withQueue(state, item.sessionId, (items) => [
        ...items,
        { ...item, id: crypto.randomUUID(), createdAt: Date.now() },
      ]),
    ),

  removeItem: (sessionId, itemId) =>
    set((state) =>
      withQueue(state, sessionId, (items) =>
        items.filter((i) => i.id !== itemId),
      ),
    ),

  popFirst: (sessionId, intent) => {
    let popped: QueueItem | undefined;
    set((state) =>
      withQueue(state, sessionId, (items) => {
        const idx = items.findIndex((i) => i.intent === intent);
        if (idx === -1) return items;
        popped = items[idx];
        return items.filter((_, i) => i !== idx);
      }),
    );
    return popped;
  },

  clearSession: (sessionId) =>
    set((state) => {
      if (!state.queues[sessionId]) return state;
      const { [sessionId]: _, ...rest } = state.queues;
      return { queues: rest };
    }),
}));

/** Selector helper: list of items for a session (never undefined). */
export function selectQueue(state: SendQueueState, sessionId: string): QueueItem[] {
  return state.queues[sessionId] ?? [];
}
