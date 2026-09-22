import { create } from 'zustand';

/**
 * "Send to background" requests in flight, keyed by tool_use id.
 *
 * The kit's ToolCallCard locks its button once clicked; this store lets the
 * host control that lock instead, so a request the server declined
 * (NO_INFLIGHT_COMMAND / BACKGROUND_UNSUPPORTED) hands the button back to the
 * user. A successful request needs no bookkeeping: the tool call settles and
 * the button disappears with it.
 */
interface BackgroundRequestState {
  pending: Record<string, { sessionId: string; requestedAt: number }>;
  markRequested: (sessionId: string, toolUseId: string) => void;
  clear: (toolUseId: string) => void;
  /** Server errors carry no tool id, so a failure releases every in-flight request. */
  clearAll: () => void;
}

export const useBackgroundRequestStore = create<BackgroundRequestState>(set => ({
  pending: {},
  markRequested: (sessionId, toolUseId) =>
    set(state => ({
      pending: { ...state.pending, [toolUseId]: { sessionId, requestedAt: Date.now() } },
    })),
  clear: toolUseId =>
    set(state => {
      if (!(toolUseId in state.pending)) return state;
      const { [toolUseId]: _removed, ...pending } = state.pending;
      return { pending };
    }),
  clearAll: () => set(state => (Object.keys(state.pending).length ? { pending: {} } : state)),
}));
