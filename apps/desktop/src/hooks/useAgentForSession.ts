/**
 * useAgentForSession — single source of truth on the frontend for resolving
 * a session's agent profile chain:
 *
 *   session.agentProfileId → agent_profile → agent_profile.llm_profile_id → llm_profile
 *
 * Both stores are auto-fetched if not yet loaded; the LLM profile store is
 * fetched elsewhere (useDataLoader), so we only kick off agent-profile fetch
 * on first read.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import { useProjectStore } from '../stores/projectStore';
import { useAgentProfileMetaStore } from '../stores/agentProfileMetaStore';
import { useLlmProfileMetaStore } from '../stores/llmProfileMetaStore';
import { useServerStore } from '../stores/serverStore';
import { useOwnershipStore } from '../stores/ownershipStore';
import { resolveSessionOwnerBackendId } from '../actions/sessionOwnership';
import { listAgentProfilesForBackend } from '../services/api/agent-profiles';
import { listLlmProfilesForBackend } from '../services/api/llm-profiles';
import { useFacadeStore } from '../stores/facadeStore';

type ScopedMetadata = {
  backendId: string;
  agents: AgentProfileConfig[];
  llms: LlmProfileConfig[];
  failed?: boolean;
};
// Profile edits affect every visible session using that owner's profile. Keep
// notifications keyed by owner so an old action cannot update a newly bound hook.
const scopedRefreshListeners = new Map<string, Set<(metadata: ScopedMetadata) => void>>();
const scopedRefreshGenerations = new Map<string, number>();

export interface AgentForSession {
  agent: AgentProfileConfig | undefined;
  llm: LlmProfileConfig | undefined;
  loading: boolean;
  backendId: string | null;
  refresh: () => Promise<void>;
  scopedMetadata: boolean;
}

export function useAgentForSession(sessionId: string | undefined): AgentForSession {
  const session = useProjectStore(s =>
    sessionId ? s.sessions.find(x => x.id === sessionId) : undefined
  );
  const agentProfileId = session?.agentProfileId;

  const agentProfiles = useAgentProfileMetaStore(s => s.profiles);
  const agentLoaded = useAgentProfileMetaStore(s => s.loaded);
  const agentLoading = useAgentProfileMetaStore(s => s.loading);
  const agentDataBackendId = useAgentProfileMetaStore(s => s.backendId);
  const loadAllAgents = useAgentProfileMetaStore(s => s.loadAll);

  const activeServerId = useServerStore(s => s.activeServerId);
  const backendId =
    useOwnershipStore(() => resolveSessionOwnerBackendId(sessionId)) ?? activeServerId;
  const ownerRuntimeState = useFacadeStore(
    s => s.backends.find(backend => backend.backendId === backendId)?.runtimeState
  );
  const ownerOpenState = useFacadeStore(
    s => s.backends.find(backend => backend.backendId === backendId)?.openState
  );
  const connectionState = useFacadeStore(s => s.connectionState);
  const reconnectGeneration = useFacadeStore(s => s.reconnectGeneration);
  const cachedLlmProfiles = useLlmProfileMetaStore(s => s.getProviders(backendId));
  const [scoped, setScoped] = useState<ScopedMetadata | null>(null);
  const needsScopedMetadata =
    !!backendId &&
    (backendId !== activeServerId ||
      (!!agentDataBackendId && agentDataBackendId !== backendId) ||
      scoped?.backendId === backendId);
  const scopedReady = scoped?.backendId === backendId && !scoped?.failed;
  const requestGeneration = useRef(0);

  const refresh = useCallback(async () => {
    if (!needsScopedMetadata && useServerStore.getState().activeServerId === backendId) {
      useAgentProfileMetaStore.getState().invalidate();
      await loadAllAgents();
      return;
    }
    if (!backendId) return;
    const generation = (scopedRefreshGenerations.get(backendId) ?? 0) + 1;
    scopedRefreshGenerations.set(backendId, generation);
    const [agents, llms] = await Promise.all([
      listAgentProfilesForBackend(backendId),
      listLlmProfilesForBackend(backendId),
    ]);
    if (scopedRefreshGenerations.get(backendId) !== generation) return;
    if (useServerStore.getState().activeServerId === backendId) {
      useAgentProfileMetaStore.getState().setAll(agents);
      useLlmProfileMetaStore.getState().setProviders(llms, backendId);
    }
    for (const listener of scopedRefreshListeners.get(backendId) ?? []) {
      listener({ backendId, agents, llms });
    }
  }, [backendId, loadAllAgents, needsScopedMetadata]);

  useEffect(() => {
    if (!needsScopedMetadata || !backendId) return;
    const listeners = scopedRefreshListeners.get(backendId) ?? new Set();
    scopedRefreshListeners.set(backendId, listeners);
    const update = (metadata: ScopedMetadata) => {
      requestGeneration.current++;
      setScoped(metadata);
    };
    listeners.add(update);
    const unsubscribeGlobal = useAgentProfileMetaStore.subscribe((state, previous) => {
      if (
        !scopedReady ||
        state.backendId !== backendId ||
        !state.loaded ||
        state.profiles === previous.profiles
      )
        return;
      requestGeneration.current++;
      setScoped(current =>
        current?.backendId === backendId
          ? { ...current, agents: Object.values(state.profiles), failed: false }
          : current
      );
    });
    return () => {
      unsubscribeGlobal();
      listeners.delete(update);
      if (!listeners.size) scopedRefreshListeners.delete(backendId);
    };
  }, [backendId, needsScopedMetadata, scopedReady]);

  useEffect(() => {
    if (!needsScopedMetadata || !backendId) return;
    let cancelled = false;
    const generation = ++requestGeneration.current;
    const initialGlobalProfiles = useAgentProfileMetaStore.getState().profiles;
    Promise.all([listAgentProfilesForBackend(backendId), listLlmProfilesForBackend(backendId)])
      .then(([agents, llms]) => {
        if (!cancelled && generation === requestGeneration.current) {
          const global = useAgentProfileMetaStore.getState();
          const latestAgents =
            global.loaded &&
            global.backendId === backendId &&
            global.profiles !== initialGlobalProfiles
              ? Object.values(global.profiles)
              : agents;
          setScoped({ backendId, agents: latestAgents, llms });
        }
      })
      .catch(error => {
        console.error('[useAgentForSession] Scoped metadata load failed:', error);
        if (!cancelled && generation === requestGeneration.current)
          setScoped({ backendId, agents: [], llms: [], failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [
    backendId,
    needsScopedMetadata,
    ownerRuntimeState,
    ownerOpenState,
    connectionState,
    reconnectGeneration,
  ]);

  useEffect(() => {
    if (!needsScopedMetadata && !agentLoaded && !agentLoading) {
      void loadAllAgents();
    }
  }, [agentLoaded, agentLoading, loadAllAgents, needsScopedMetadata]);

  const agent = agentProfileId
    ? needsScopedMetadata
      ? scopedReady
        ? scoped?.agents.find(profile => profile.id === agentProfileId)
        : undefined
      : agentProfiles[agentProfileId]
    : undefined;
  const llmProfiles = needsScopedMetadata
    ? scopedReady
      ? (scoped?.llms ?? [])
      : []
    : cachedLlmProfiles;
  const llm = agent ? llmProfiles.find(p => p.id === agent.llmProfileId) : undefined;
  // loading is only meaningful when this session actually needs something:
  //   - agentLoading matters only when a profile is expected (agentProfileId set) and not yet resolved
  //   - llmProfileMetaStore has no loading flag; guard is omitted until one is added
  const loading = needsScopedMetadata ? !scopedReady : agentLoading && !!agentProfileId && !agent;

  return { agent, llm, loading, backendId, refresh, scopedMetadata: needsScopedMetadata };
}
