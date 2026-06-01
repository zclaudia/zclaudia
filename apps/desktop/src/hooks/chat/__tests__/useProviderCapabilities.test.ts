import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import * as api from '../../../services/api';
import { useProviderCapabilities } from '../useProviderCapabilities';
import { useProjectStore } from '../../../stores/projectStore';
import { useProviderMetaStore } from '../../../stores/providerMetaStore';
import { useServerStore } from '../../../stores/serverStore';
import { useChatStore } from '../../../stores/chatStore';

vi.mock('../../../services/api', () => ({
  getProviderCommands: vi.fn(),
  getProviderTypeCommands: vi.fn(),
  getProviderCapabilities: vi.fn(),
  getProviderTypeCapabilities: vi.fn(),
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

    useProviderMetaStore.setState({
      providersByBackend: {},
      providerCommands: {},
      providerCapabilities: {},
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
      getMode: vi.fn(() => null),
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
        'claude',
        '/test',
        expect.any(Object)
      );
      expect(api.getProviderTypeCapabilities).toHaveBeenCalledWith(
        'claude',
        expect.any(Object)
      );
    });

    expect(result.current.llmProfileId).toBeUndefined();
    expect(useProviderMetaStore.getState().providerCommands['local:_default']).toEqual(
      expect.arrayContaining([{ command: '/help', description: 'help', source: 'provider' }])
    );
    expect(useProviderMetaStore.getState().providerCapabilities['local:_default']).toEqual(
      expect.objectContaining({ defaultModeId: 'plan' })
    );
    expect(useChatStore.getState().setMode).toHaveBeenCalledWith('sess-1', 'plan');
  });

  it('loads provider-specific metadata when project has llmProfileId', async () => {
    // Sub-project B removed `session.llmProfileId`; the hook now resolves the
    // profile via `project.llmProfileId` (see `useProviderCapabilities.ts`
    // TODO(agent-profiles) — will be re-routed through agent_profile.llm_profile_id
    // when sub-project C wires agent.llm_profile_id through the session payload).
    useProjectStore.setState({
      projects: [{ id: 'proj-1', name: 'Project', rootPath: '/test', llmProfileId: 'prov-1' }],
      sessions: [{ id: 'sess-1', projectId: 'proj-1', name: 'Session' }],
      providers: [{ id: 'prov-1', name: 'Claude', type: 'claude' }],
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
    expect(useProviderMetaStore.getState().providerCommands['local:prov-1']).toEqual(
      expect.arrayContaining([{ command: '/provider', description: 'provider', source: 'provider' }])
    );
    expect(useProviderMetaStore.getState().providerCapabilities['local:prov-1']).toEqual(
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
