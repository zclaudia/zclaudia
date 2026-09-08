import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useAgentInitialization } from '../useAgentInitialization';

const { getAgentConfig, ensureAgent } = vi.hoisted(() => ({
  getAgentConfig: vi.fn(),
  ensureAgent: vi.fn(),
}));

vi.mock('../../services/api/servers', () => ({
  getAgentConfig,
  ensureAgent,
  updateAgentConfig: vi.fn(),
}));

const config = {
  enabled: true,
  projectId: null,
  sessionId: null,
  llmProfileId: null,
  permissionWorkflowOverrideId: null,
  permissionPolicy: null,
};

describe('useAgentInitialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentConfigStore.setState({
      config: null,
      hasLoaded: false,
      isLoading: false,
      error: null,
    });
    getAgentConfig.mockResolvedValue(config);
    ensureAgent.mockResolvedValue({ projectId: 'host-project', sessionId: 'host-session' });
  });

  it('loads configuration and ensures the host only after the connection is ready', async () => {
    const { rerender } = renderHook(({ state }) => useAgentInitialization(state), {
      initialProps: { state: 'connecting' },
    });
    expect(getAgentConfig).not.toHaveBeenCalled();
    expect(ensureAgent).not.toHaveBeenCalled();

    rerender({ state: 'ready' });
    await waitFor(() => expect(ensureAgent).toHaveBeenCalledTimes(1));
    expect(getAgentConfig).toHaveBeenCalledTimes(1);
    expect(useAgentConfigStore.getState().hasLoaded).toBe(true);
  });

  it('waits for the assistant to be enabled before ensuring its host project', async () => {
    getAgentConfig.mockResolvedValue({ ...config, enabled: false });
    renderHook(() => useAgentInitialization('ready'));
    await waitFor(() => expect(useAgentConfigStore.getState().hasLoaded).toBe(true));
    expect(ensureAgent).not.toHaveBeenCalled();

    act(() => useAgentConfigStore.setState({ config }));
    await waitFor(() => expect(ensureAgent).toHaveBeenCalledTimes(1));
  });

  it('does not ensure a host when configuration loading fails', async () => {
    getAgentConfig.mockRejectedValue(new Error('Backend unavailable'));
    renderHook(() => useAgentInitialization('ready'));
    await waitFor(() => expect(useAgentConfigStore.getState().error).toBe('Backend unavailable'));
    expect(ensureAgent).not.toHaveBeenCalled();
  });
});
