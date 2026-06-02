// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { AgentProfileConfig, LlmProfileConfig } from '@zclaudia/shared';

import { useAgentForSession } from '../useAgentForSession';
import { useProjectStore } from '../../stores/projectStore';
import { useAgentProfileMetaStore } from '../../stores/agentProfileMetaStore';
import { useLlmProfileMetaStore } from '../../stores/llmProfileMetaStore';
import { useServerStore } from '../../stores/serverStore';
import * as agentApi from '../../services/api/agent-profiles';

vi.mock('../../services/api/agent-profiles', () => ({
  listAgentProfiles: vi.fn(),
}));

const llmProfile: LlmProfileConfig = {
  id: 'lp1',
  name: 'Local LLM',
  providerType: 'anthropic',
  isDefault: true,
  createdAt: 0,
  updatedAt: 0,
};

const agentProfile: AgentProfileConfig = {
  id: 'ap1',
  name: 'Coder',
  llmProfileId: 'lp1',
  enabledTools: ['read'],
  isDefault: true,
  createdAt: 0,
  updatedAt: 0,
};

function resetStores() {
  // Reset agent profile store
  useAgentProfileMetaStore.setState({
    profiles: {},
    loaded: false,
    loading: false,
  } as any);

  // Reset llm profile store
  useLlmProfileMetaStore.setState({
    providersByBackend: { local: [llmProfile] },
    providerCommands: {},
    providerCapabilities: {},
  } as any);

  useServerStore.setState({
    activeServerId: 'local',
    connections: {
      local: { status: 'connected', error: null, isLocalConnection: true, features: [] },
    },
  } as any);
}

describe('useAgentForSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    vi.mocked(agentApi.listAgentProfiles).mockResolvedValue([agentProfile]);

    useProjectStore.setState({
      sessions: [
        { id: 'sess-1', projectId: 'proj-1', name: 'Session', agentProfileId: 'ap1' },
        { id: 'sess-no-agent', projectId: 'proj-1', name: 'Bare' },
      ],
      projects: [{ id: 'proj-1', name: 'Project', rootPath: '/tmp' }],
    } as any);
  });

  it('returns { agent, llm } once both stores are populated', async () => {
    // Seed the agent store so getById can hit immediately.
    useAgentProfileMetaStore.setState({
      profiles: { ap1: agentProfile },
      loaded: true,
      loading: false,
    } as any);

    const { result } = renderHook(() => useAgentForSession('sess-1'));

    await waitFor(() => {
      expect(result.current.agent?.id).toBe('ap1');
      expect(result.current.llm?.id).toBe('lp1');
    });
  });

  it('returns undefined agent/llm when the session has no agentProfileId', () => {
    useAgentProfileMetaStore.setState({
      profiles: { ap1: agentProfile },
      loaded: true,
      loading: false,
    } as any);

    const { result } = renderHook(() => useAgentForSession('sess-no-agent'));

    expect(result.current.agent).toBeUndefined();
    expect(result.current.llm).toBeUndefined();
  });

  it('returns undefined agent/llm when the session id does not match any session', () => {
    useAgentProfileMetaStore.setState({
      profiles: { ap1: agentProfile },
      loaded: true,
      loading: false,
    } as any);

    const { result } = renderHook(() => useAgentForSession('does-not-exist'));

    expect(result.current.agent).toBeUndefined();
    expect(result.current.llm).toBeUndefined();
  });

  it('triggers agent profile store fetch when not yet loaded', async () => {
    const { result } = renderHook(() => useAgentForSession('sess-1'));

    await waitFor(() => {
      expect(agentApi.listAgentProfiles).toHaveBeenCalledTimes(1);
    });
    // After load, agent + llm should resolve.
    await waitFor(() => {
      expect(result.current.agent?.id).toBe('ap1');
      expect(result.current.llm?.id).toBe('lp1');
    });
  });
});
