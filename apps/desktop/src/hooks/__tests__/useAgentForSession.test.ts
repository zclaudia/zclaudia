// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';

import { useAgentForSession } from '../useAgentForSession';
import { useProjectStore } from '../../stores/projectStore';
import { useAgentProfileMetaStore } from '../../stores/agentProfileMetaStore';
import { useLlmProfileMetaStore } from '../../stores/llmProfileMetaStore';
import { useServerStore } from '../../stores/serverStore';
import * as agentApi from '../../services/api/agent-profiles';
import * as llmApi from '../../services/api/llm-profiles';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useFacadeStore } from '../../stores/facadeStore';

vi.mock('../../services/api/agent-profiles', () => ({
  listAgentProfiles: vi.fn(),
  listAgentProfilesForBackend: vi.fn(),
}));
vi.mock('../../services/api/llm-profiles', () => ({ listLlmProfilesForBackend: vi.fn() }));

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
  model: 'claude-sonnet-4-6',
  systemPrompt: '',
  enabledTools: ['read'],
  isDefault: true,
  createdAt: 0,
  updatedAt: 0,
};

function resetStores() {
  useOwnershipStore.setState({ projectBackendIds: {}, sessionBackendIds: {} });
  useFacadeStore.setState({ reconnectGeneration: 0, backends: [] });
  // Reset agent profile store
  useAgentProfileMetaStore.setState({
    profiles: {},
    loaded: false,
    loading: false,
    backendId: null,
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

  it('resolves owner A profiles without reusing same IDs or readonly status from active B', async () => {
    useOwnershipStore.setState({ projectBackendIds: { 'proj-1': 'owner-A' }, sessionBackendIds: { 'sess-1': 'owner-A' } });
    useAgentProfileMetaStore.setState({ profiles: { ap1: { ...agentProfile, name: 'B agent', status: 'readonly' } }, loaded: true });
    useLlmProfileMetaStore.setState({ providersByBackend: { local: [{ ...llmProfile, name: 'B LLM' }] } });
    vi.mocked(agentApi.listAgentProfilesForBackend).mockResolvedValue([{ ...agentProfile, name: 'A agent' }]);
    vi.mocked(llmApi.listLlmProfilesForBackend).mockResolvedValue([{ ...llmProfile, name: 'A LLM' }]);
    const { result } = renderHook(() => useAgentForSession('sess-1'));
    expect(result.current.agent).toBeUndefined();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.agent?.name).toBe('A agent');
    expect(result.current.agent?.status).not.toBe('readonly');
    expect(result.current.llm?.name).toBe('A LLM');
    expect(agentApi.listAgentProfilesForBackend).toHaveBeenCalledExactlyOnceWith('owner-A');
    expect(llmApi.listLlmProfilesForBackend).toHaveBeenCalledExactlyOnceWith('owner-A');
    expect(agentApi.listAgentProfiles).not.toHaveBeenCalled();
    act(() => useServerStore.getState().setActiveServer('owner-A'));
    expect(result.current.agent?.name).toBe('A agent');
    expect(result.current.llm?.name).toBe('A LLM');
    expect(result.current.scopedMetadata).toBe(true);
    act(() => useAgentProfileMetaStore.getState().setAll([{ ...agentProfile, name: 'Edited A agent' }]));
    expect(result.current.agent?.name).toBe('Edited A agent');
    await act(async () => result.current.refresh());
    expect(useAgentProfileMetaStore.getState().backendId).toBe('owner-A');
    expect(useAgentProfileMetaStore.getState().getById('ap1')?.name).toBe('A agent');
    expect(useLlmProfileMetaStore.getState().getProviders('owner-A')[0]?.name).toBe('A LLM');
    act(() => useServerStore.getState().setActiveServer('local'));
    act(() => useAgentProfileMetaStore.getState().setAll([{ ...agentProfile, name: 'Edited B agent' }]));
    expect(result.current.agent?.name).toBe('A agent');
  });

  it('does not use stale active-backend agent metadata after switching onto a session owner', async () => {
    useAgentProfileMetaStore.getState().setAll([{ ...agentProfile, name: 'B agent', status: 'readonly' }]);
    useOwnershipStore.setState({ projectBackendIds: { 'proj-1': 'owner-A' } });
    act(() => useServerStore.getState().setActiveServer('owner-A'));
    vi.mocked(agentApi.listAgentProfilesForBackend).mockResolvedValue([{ ...agentProfile, name: 'A agent' }]);
    vi.mocked(llmApi.listLlmProfilesForBackend).mockResolvedValue([llmProfile]);
    const { result } = renderHook(() => useAgentForSession('sess-1'));
    expect(result.current.agent).toBeUndefined();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.agent?.name).toBe('A agent'));
    expect(result.current.agent?.status).not.toBe('readonly');
  });

  it('ignores an old owner refresh completion when this hook switches session owners', async () => {
    useOwnershipStore.setState({ sessionBackendIds: { 'sess-1': 'owner-A', 'sess-no-agent': 'owner-B' } });
    vi.mocked(agentApi.listAgentProfilesForBackend).mockResolvedValue([agentProfile]);
    vi.mocked(llmApi.listLlmProfilesForBackend).mockResolvedValue([llmProfile]);
    const { result, rerender } = renderHook(({ sessionId }) => useAgentForSession(sessionId), { initialProps: { sessionId: 'sess-1' } });
    await waitFor(() => expect(result.current.agent?.name).toBe('Coder'));
    let resolve!: (profiles: AgentProfileConfig[]) => void;
    vi.mocked(agentApi.listAgentProfilesForBackend).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refresh(); });
    rerender({ sessionId: 'sess-no-agent' });
    await waitFor(() => expect(result.current.backendId).toBe('owner-B'));
    await act(async () => { resolve([{ ...agentProfile, name: 'Old A' }]); await refresh; });
    expect(result.current.backendId).toBe('owner-B');
    expect(result.current.agent).toBeUndefined();
    expect(result.current.loading).toBe(false);
  });

  it('routes a captured A refresh invoked after switching to B only to still-mounted A consumers', async () => {
    useProjectStore.setState({ sessions: [
      { id: 'sess-1', projectId: 'proj-1', agentProfileId: 'ap1' },
      { id: 'sess-2', projectId: 'proj-1', agentProfileId: 'ap1' },
    ] } as any);
    useOwnershipStore.setState({ sessionBackendIds: { 'sess-1': 'owner-A', 'sess-2': 'owner-B' } });
    vi.mocked(agentApi.listAgentProfilesForBackend).mockImplementation(async backendId => [{ ...agentProfile, name: `${backendId} agent` }]);
    vi.mocked(llmApi.listLlmProfilesForBackend).mockResolvedValue([llmProfile]);
    const moving = renderHook(({ sid }) => useAgentForSession(sid), { initialProps: { sid: 'sess-1' } });
    const sibling = renderHook(() => useAgentForSession('sess-1'));
    await waitFor(() => expect(moving.result.current.agent?.name).toBe('owner-A agent'));
    await waitFor(() => expect(sibling.result.current.agent?.name).toBe('owner-A agent'));
    const refreshA = moving.result.current.refresh;
    moving.rerender({ sid: 'sess-2' });
    await waitFor(() => expect(moving.result.current.agent?.name).toBe('owner-B agent'));
    vi.mocked(agentApi.listAgentProfilesForBackend).mockResolvedValue([{ ...agentProfile, name: 'Refreshed A' }]);
    await act(async () => refreshA());
    expect(sibling.result.current.agent?.name).toBe('Refreshed A');
    expect(moving.result.current.agent?.name).toBe('owner-B agent');
    expect(moving.result.current.loading).toBe(false);
  });

  it('broadcasts only the newest concurrent owner refresh', async () => {
    useOwnershipStore.setState({ sessionBackendIds: { 'sess-1': 'owner-A' } });
    vi.mocked(agentApi.listAgentProfilesForBackend).mockResolvedValue([agentProfile]);
    vi.mocked(llmApi.listLlmProfilesForBackend).mockResolvedValue([llmProfile]);
    const { result } = renderHook(() => useAgentForSession('sess-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let resolveOld!: (profiles: AgentProfileConfig[]) => void;
    vi.mocked(agentApi.listAgentProfilesForBackend).mockReturnValueOnce(new Promise(done => { resolveOld = done; }))
      .mockResolvedValueOnce([{ ...agentProfile, name: 'Newest A' }]);
    let old!: Promise<void>;
    act(() => { old = result.current.refresh(); });
    await act(async () => result.current.refresh());
    expect(result.current.agent?.name).toBe('Newest A');
    await act(async () => { resolveOld([{ ...agentProfile, name: 'Old A' }]); await old; });
    expect(result.current.agent?.name).toBe('Newest A');
  });

  it('refreshes the owner when a captured legacy refresh is invoked after the active backend changes', async () => {
    useOwnershipStore.setState({ sessionBackendIds: { 'sess-1': 'local' } });
    useAgentProfileMetaStore.getState().setAll([agentProfile]);
    vi.mocked(agentApi.listAgentProfilesForBackend).mockResolvedValue([agentProfile]);
    vi.mocked(llmApi.listLlmProfilesForBackend).mockResolvedValue([llmProfile]);
    const { result } = renderHook(() => useAgentForSession('sess-1'));
    const capturedRefresh = result.current.refresh;
    act(() => {
      useServerStore.getState().setActiveServer('B');
      useAgentProfileMetaStore.getState().setAll([{ ...agentProfile, name: 'B agent' }]);
    });
    await waitFor(() => expect(result.current.scopedMetadata && !result.current.loading).toBe(true));
    vi.mocked(agentApi.listAgentProfilesForBackend).mockResolvedValue([{ ...agentProfile, name: 'Updated local owner' }]);
    await act(async () => capturedRefresh());
    expect(result.current.agent?.name).toBe('Updated local owner');
    expect(agentApi.listAgentProfilesForBackend).toHaveBeenLastCalledWith('local');
    expect(useAgentProfileMetaStore.getState().getById('ap1')?.name).toBe('B agent');
    expect(useAgentProfileMetaStore.getState().backendId).toBe('B');
  });

  it('does not treat a failed owner fetch as an orphan and retries on reconnect', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    useOwnershipStore.setState({ projectBackendIds: { 'proj-1': 'owner-A' } });
    useAgentProfileMetaStore.setState({ profiles: { ap1: { ...agentProfile, status: 'readonly' } }, loaded: true });
    vi.mocked(agentApi.listAgentProfilesForBackend).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([agentProfile]);
    vi.mocked(llmApi.listLlmProfilesForBackend).mockResolvedValue([llmProfile]);
    const { result } = renderHook(() => useAgentForSession('sess-1'));
    await waitFor(() => expect(errorLog).toHaveBeenCalled());
    expect(result.current.loading).toBe(true);
    expect(result.current.agent).toBeUndefined();
    act(() => useFacadeStore.setState({ reconnectGeneration: 1 }));
    await waitFor(() => expect(result.current.agent?.name).toBe('Coder'));
    expect(result.current.loading).toBe(false);
    expect(agentApi.listAgentProfilesForBackend).toHaveBeenCalledTimes(2);
    errorLog.mockRestore();
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

  it('reflects agent profile metadata replacement for existing sessions', async () => {
    useAgentProfileMetaStore.setState({
      profiles: { ap1: agentProfile },
      loaded: true,
      loading: false,
    } as any);

    const { result } = renderHook(() => useAgentForSession('sess-1'));
    expect(result.current.agent?.model).toBe('claude-sonnet-4-6');

    useAgentProfileMetaStore
      .getState()
      .setAll([{ ...agentProfile, model: 'kimi-k2.7-code', updatedAt: 1 }]);

    await waitFor(() => {
      expect(result.current.agent?.model).toBe('kimi-k2.7-code');
    });
  });
});
