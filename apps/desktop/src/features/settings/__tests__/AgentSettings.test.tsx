import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AgentSettings } from '../AgentSettings';
import { useAgentConfigStore } from '../../../stores/agentConfigStore';
import { useServerStore } from '../../../stores/serverStore';
import { useFacadeStore } from '../../../stores/facadeStore';

const mockGetAgentConfig = vi.fn();
const mockUpdateAgentConfig = vi.fn();
const mockFetchApiForBackend = vi.fn();
const mockListLlmProfilesForBackend = vi.fn();

vi.mock('../../../services/api/servers', () => ({
  getAgentConfig: (...args: unknown[]) => mockGetAgentConfig(...args),
  updateAgentConfig: (...args: unknown[]) => mockUpdateAgentConfig(...args),
}));

vi.mock('../../../services/api', () => ({
  listLlmProfilesForBackend: (...args: unknown[]) => mockListLlmProfilesForBackend(...args),
}));

vi.mock('../../../services/api/base', () => ({
  fetchApiForBackend: (...args: unknown[]) => mockFetchApiForBackend(...args),
}));

vi.mock('../../../utils/platform', async importOriginal => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, isDesktopTauri: () => false };
});

vi.mock('../ManagedRuntimeSettings', () => ({
  ManagedRuntimeSettings: () => <div data-testid="managed-runtime-stub" />,
}));

const AGENT_CONFIG = {
  id: 1,
  enabled: true,
  projectId: null,
  sessionId: null,
  llmProfileId: null,
  permissionWorkflowOverrideId: null,
  permissionPolicy: null,
};

describe('AgentSettings', () => {
  beforeEach(() => {
    mockGetAgentConfig.mockReset();
    mockUpdateAgentConfig.mockReset();
    mockFetchApiForBackend.mockReset();
    mockListLlmProfilesForBackend.mockReset();

    useAgentConfigStore.setState({
      config: null,
      isLoading: false,
      isSaving: false,
      hasLoaded: false,
      error: null,
    });
    useServerStore.setState({ activeServerId: 'local' } as any);
    useFacadeStore.setState({ localBackendId: 'local', backends: [] } as any);

    mockGetAgentConfig.mockResolvedValue(AGENT_CONFIG);
    mockUpdateAgentConfig.mockResolvedValue(AGENT_CONFIG);
    mockFetchApiForBackend.mockResolvedValue({
      success: true,
      data: { tools: [], skills: [], contextTemplates: [], maxConcurrentTasks: 1 },
    });
    mockListLlmProfilesForBackend.mockResolvedValue([]);
  });

  it('targets the local backend without a banner on desktop', async () => {
    render(<AgentSettings />);

    expect(await screen.findByText('Claudia')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockGetAgentConfig).toHaveBeenCalledWith('local');
      expect(mockFetchApiForBackend).toHaveBeenCalledWith('/api/agent/capabilities', 'local');
      expect(mockListLlmProfilesForBackend).toHaveBeenCalledWith('local');
    });

    expect(screen.queryByTestId('settings-target-backend-banner')).toBeNull();
  });

  it('targets the active backend and shows a banner when no local backend exists', async () => {
    useServerStore.setState({ activeServerId: 'remote-1' } as any);
    useFacadeStore.setState({
      localBackendId: null,
      backends: [{ backendId: 'remote-1', name: 'Work Laptop', isThisInstance: false }],
    } as any);

    render(<AgentSettings />);

    const banner = await screen.findByTestId('settings-target-backend-banner');
    expect(banner).toHaveTextContent('These settings apply to the connected backend:');
    expect(banner).toHaveTextContent('Work Laptop');

    await waitFor(() => {
      expect(mockGetAgentConfig).toHaveBeenCalledWith('remote-1');
      expect(mockFetchApiForBackend).toHaveBeenCalledWith('/api/agent/capabilities', 'remote-1');
      expect(mockListLlmProfilesForBackend).toHaveBeenCalledWith('remote-1');
    });
  });

  it('renders a disabled notice and makes no requests when no backend exists at all', async () => {
    useServerStore.setState({ activeServerId: null } as any);
    useFacadeStore.setState({ localBackendId: null, backends: [] } as any);

    render(<AgentSettings />);

    expect(await screen.findByTestId('settings-no-backend-notice')).toBeInTheDocument();
    expect(screen.queryByText('Claudia')).toBeNull();
    expect(mockGetAgentConfig).not.toHaveBeenCalled();
    expect(mockFetchApiForBackend).not.toHaveBeenCalled();
  });
});
