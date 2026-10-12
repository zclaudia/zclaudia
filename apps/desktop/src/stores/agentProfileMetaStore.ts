/**
 * Agent profile metadata store — caches AgentProfileConfig records loaded from
 * the active backend. Mirrors the shape of `llmProfileMetaStore` but for agent
 * profiles (a higher-level concept that wraps an LLM profile + system prompt +
 * enabled tools + model + thinking level).
 *
 * The frontend uses this together with `useAgentForSession` to resolve a session's
 * agent profile → LLM profile chain without re-querying the server per render.
 */
import { create } from 'zustand';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import { listAgentProfiles } from '../services/api/agent-profiles';
import { getActiveServerId } from '../services/active-backend-coordination';

interface AgentProfileMetaState {
  profiles: Record<string, AgentProfileConfig>;
  loaded: boolean;
  loading: boolean;
  backendId: string | null;
  loadAll: () => Promise<void>;
  setAll: (profiles: AgentProfileConfig[]) => void;
  getById: (id: string) => AgentProfileConfig | undefined;
  invalidate: (id?: string) => void;
}

export const useAgentProfileMetaStore = create<AgentProfileMetaState>((set, get) => ({
  profiles: {},
  loaded: false,
  loading: false,
  backendId: null,

  async loadAll() {
    if (get().loading) return;
    const backendId = getActiveServerId();
    set({ loading: true });
    try {
      const all = await listAgentProfiles();
      if (getActiveServerId() !== backendId) {
        set({ loading: false });
        return;
      }
      get().setAll(all);
      set({ loading: false });
    } catch (err) {
      console.error('[agentProfileMetaStore] loadAll failed:', err);
      if (getActiveServerId() !== backendId) {
        set({ loading: false });
        return;
      }
      // Mark as "loaded" even on failure to avoid an infinite refetch loop —
      // consumers can call invalidate() to retry.
      set({
        loaded: true,
        loading: false,
        backendId,
        ...(get().backendId !== backendId ? { profiles: {} } : {}),
      });
    }
  },

  setAll(profiles) {
    const byId: Record<string, AgentProfileConfig> = {};
    for (const a of profiles) byId[a.id] = a;
    set({ profiles: byId, loaded: true, backendId: getActiveServerId() });
  },

  getById(id) {
    return get().profiles[id];
  },

  invalidate(id) {
    if (id) {
      const next = { ...get().profiles };
      delete next[id];
      set({ profiles: next, loaded: false });
    } else {
      set({ profiles: {}, loaded: false });
    }
  },
}));
