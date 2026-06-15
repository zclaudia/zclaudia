import { create } from 'zustand';
import type { AgentReadiness } from '@zclaudia/shared/core/agent-readiness';
import { getAgentReadiness } from '../services/api/readiness';

interface AgentReadinessState {
  readiness: AgentReadiness | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** True unless we have positively determined the agent is unusable. */
  isUsable: () => boolean;
}

export const useAgentReadinessStore = create<AgentReadinessState>((set, get) => ({
  readiness: null,
  loading: false,
  refresh: async () => {
    set({ loading: true });
    try {
      const readiness = await getAgentReadiness();
      set({ readiness, loading: false });
    } catch (err) {
      console.error('[agentReadiness] refresh failed, failing open:', err);
      set({ readiness: { usable: true }, loading: false });
    }
  },
  isUsable: () => {
    const r = get().readiness;
    return r === null ? true : r.usable;
  },
}));
