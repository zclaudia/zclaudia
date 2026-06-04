import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import * as api from '../../../services/api';
import { useProviderCapabilities } from '../useProviderCapabilities';
import { useProjectStore } from '../../../stores/projectStore';
import { useLlmProfileMetaStore } from '../../../stores/llmProfileMetaStore';
import { useAgentProfileMetaStore } from '../../../stores/agentProfileMetaStore';
import { useServerStore } from '../../../stores/serverStore';
import { useChatStore } from '../../../stores/chatStore';

vi.mock('../../../services/api', () => ({
  getProviderCommands: vi.fn(),
  getProviderTypeCommands: vi.fn(),
  getProviderCapabilities: vi.fn(),
  getProviderTypeCapabilities: vi.fn(),
}));

// useAgentForSession imports listAgentProfiles directly from
// '../services/api/agent-profiles' (not the barrel). Mock it to avoid making
// real network requests inside the agent store's loadAll().
vi.mock('../../../services/api/agent-profiles', () => ({
  listAgentProfiles: vi.fn().mockResolvedValue([]),
}));

describe('useProviderCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useServerStore.setState({
      activeServerId: 'local',
      connections: {
        local: { status: 'connected', error: null, isLocalConnection: true, features: [] },
      },
    } as any);

    useLlmProfileMetaStore.setState({
      providersByBackend: {},
      providerCommands: {},
      providerCapabilities: {},
    } as any);

    useAgentProfileMetaStore.setState({
      profiles: {},
      loaded: true,
      loading: false,
    } as any);

    useProjectStore.setState({
      projects: [{ id: 'proj-1', name: 'Project', rootPath: '/test' }],
      sessions: [{ id: 'sess-1', projectId: 'proj-1', name: 'Session' }],
      providers: [],
      providerCommands: {},
      providerCapabilities: {},
      dataServerId: 'local',
      setProviderCommands: useProjectStore.getState().setProviderCommands,
      setProviderCapabilities: useProjectStore.getState().setProviderCapabilities,
    } as any);

    useChatStore.setState({
      getMode: vi.fn(() => ''),
      setMode: vi.fn(),
    } as any);

    vi.mocked(api.getProviderTypeCommands).mockResolvedValue([
      { command: '/help', description: 'help', source: 'provider' },
    ] as any);
    vi.mocked(api.getProviderCommands).mockResolvedValue([
      { command: '/provider', description: 'provider', source: 'provider' },
    ] as any);
    vi.mocked(api.getProviderTypeCapabilities).mockResolvedValue({
      supportsImages: true,
      defaultModeId: 'plan',
    } as any);
    vi.mocked(api.getProviderCapabilities).mockResolvedValue({
      supportsImages: true,
      defaultModeId: 'code',
    } as any);
  });

  it('loads default provider metadata when no llmProfileId is set', async () => {
    const { result } = renderHook(() =>
      useProviderCapabilities({ sessionId: 'sess-1', isConnected: true })
    );

    await waitFor(() => {
      expect(api.getProviderTypeCommands).toHaveBeenCalledWith(
        'zclaudia',
        '/test',
        expect.any(Object)
      );
      expect(api.getProviderTypeCapabilities).toHaveBeenCalledWith(
        'zclaudia',
        expect.any(Object)
      );
    });

    expect(result.current.llmProfileId).toBeUndefined();
    expect(useLlmProfileMetaStore.getState().providerCommands['local:_default']).toEqual(
      expect.arrayContaining([{ command: '/help', description: 'help', source: 'provider' }])
    );
    expect(useLlmProfileMetaStore.getState().providerCapabilities['local:_default']).toEqual(
      expect.objectContaining({ defaultModeId: 'plan' })
    );
    // Capabilities arrive for an unset session → setMode seeded from defaultModeId.
    expect((useChatStore.getState() as any).setMode).toHaveBeenCalledWith('sess-1', 'plan');
  });

  it('loads provider-specific metadata when session resolves to agent → llm-profile', async () => {
    // The session points at an agent profile; the agent profile points at an LLM
    // profile. useProviderCapabilities resolves both via useAgentForSession.
    useProjectStore.setState({
      projects: [{ id: 'proj-1', name: 'Project', rootPath: '/test' }],
      sessions: [{ id: 'sess-1', projectId: 'proj-1', name: 'Session', agentProfileId: 'ap-1' }],
      providers: [],
    } as any);

    useAgentProfileMetaStore.setState({
      profiles: {
        'ap-1': {
          id: 'ap-1',
          name: 'Coder',
          llmProfileId: 'prov-1',
          enabledTools: [],
          isDefault: true,
          createdAt: 0,
          updatedAt: 0,
        },
      },
      loaded: true,
      loading: false,
    } as any);

    useLlmProfileMetaStore.setState({
      providersByBackend: {
        local: [{ id: 'prov-1', name: 'Claude', providerType: 'claude', createdAt: 0, updatedAt: 0 }],
      },
      providerCommands: {},
      providerCapabilities: {},
    } as any);

    const { result } = renderHook(() =>
      useProviderCapabilities({ sessionId: 'sess-1', isConnected: true })
    );

    await waitFor(() => {
      expect(api.getProviderCommands).toHaveBeenCalledWith(
        'prov-1',
        '/test',
        expect.any(Object)
      );
      expect(api.getProviderCapabilities).toHaveBeenCalledWith(
        'prov-1',
        expect.any(Object)
      );
    });

    expect(result.current.llmProfileId).toBe('prov-1');
    expect(useLlmProfileMetaStore.getState().providerCommands['local:prov-1']).toEqual(
      expect.arrayContaining([{ command: '/provider', description: 'provider', source: 'provider' }])
    );
    expect(useLlmProfileMetaStore.getState().providerCapabilities['local:prov-1']).toEqual(
      expect.objectContaining({ defaultModeId: 'code' })
    );
  });

  it('does not fetch metadata when disconnected', async () => {
    renderHook(() =>
      useProviderCapabilities({ sessionId: 'sess-1', isConnected: false })
    );

    await Promise.resolve();

    expect(api.getProviderTypeCommands).not.toHaveBeenCalled();
    expect(api.getProviderTypeCapabilities).not.toHaveBeenCalled();
  });

  it('does not fetch metadata when backend data is stale', async () => {
    useProjectStore.setState({ dataServerId: 'remote' } as any);

    renderHook(() =>
      useProviderCapabilities({ sessionId: 'sess-1', isConnected: true })
    );

    await Promise.resolve();

    expect(api.getProviderTypeCommands).not.toHaveBeenCalled();
    expect(api.getProviderTypeCapabilities).not.toHaveBeenCalled();
  });
});
