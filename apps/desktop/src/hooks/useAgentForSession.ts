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
import { useEffect } from 'react';
import type { AgentProfileConfig, LlmProfileConfig } from '@zclaudia/shared';
import { useProjectStore } from '../stores/projectStore';
import { useAgentProfileMetaStore } from '../stores/agentProfileMetaStore';
import { useLlmProfileMetaStore } from '../stores/llmProfileMetaStore';
import { useServerStore } from '../stores/serverStore';

export interface AgentForSession {
  agent: AgentProfileConfig | undefined;
  llm: LlmProfileConfig | undefined;
  loading: boolean;
}

export function useAgentForSession(sessionId: string | undefined): AgentForSession {
  const session = useProjectStore((s) =>
    sessionId ? s.sessions.find((x) => x.id === sessionId) : undefined
  );
  const agentProfileId = session?.agentProfileId;

  const agentProfiles = useAgentProfileMetaStore((s) => s.profiles);
  const agentLoaded = useAgentProfileMetaStore((s) => s.loaded);
  const agentLoading = useAgentProfileMetaStore((s) => s.loading);
  const loadAllAgents = useAgentProfileMetaStore((s) => s.loadAll);

  const activeServerId = useServerStore((s) => s.activeServerId);
  const llmProfiles = useLlmProfileMetaStore((s) => s.getProviders(activeServerId));

  useEffect(() => {
    if (!agentLoaded && !agentLoading) {
      void loadAllAgents();
    }
  }, [agentLoaded, agentLoading, loadAllAgents]);

  const agent = agentProfileId ? agentProfiles[agentProfileId] : undefined;
  const llm = agent ? llmProfiles.find((p) => p.id === agent.llmProfileId) : undefined;
  const loading = agentLoading && !agent;

  return { agent, llm, loading };
}
