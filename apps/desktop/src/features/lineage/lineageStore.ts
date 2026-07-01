import { create } from 'zustand';
import type { ContextGraph } from '@zclaudia/shared';
import { fetchContextGraph } from '../../services/api/context-graph';
import { useToastStore } from '../../stores/toastStore';

interface LineageState {
  graph: ContextGraph | null;
  loading: boolean;
  requestId: number;
  reload: (sessionId: string | null | undefined) => Promise<void>;
  reset: () => void;
}

const initialState = {
  graph: null,
  loading: false,
  requestId: 0,
};

export const useLineageStore = create<LineageState>((set, get) => ({
  ...initialState,

  reload: async (sessionId) => {
    const requestId = get().requestId + 1;

    if (!sessionId) {
      set({ ...initialState, requestId });
      return;
    }

    set({ requestId, loading: true });
    try {
      const next = await fetchContextGraph(sessionId);
      if (get().requestId === requestId) set({ graph: next });
    } catch {
      if (get().requestId === requestId) {
        useToastStore.getState().add({ type: 'error', title: 'Lineage for this session is unavailable' });
        set({ graph: null });
      }
    } finally {
      if (get().requestId === requestId) set({ loading: false });
    }
  },

  reset: () => set(initialState),
}));
