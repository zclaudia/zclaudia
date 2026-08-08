import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PermissionSettings } from '../PermissionSettings';
import { useLlmProfileMetaStore } from '../../../stores/llmProfileMetaStore';
import { useServerStore } from '../../../stores/serverStore';
import { useFacadeStore } from '../../../stores/facadeStore';
import { isMacOS } from '../../../utils/platform';
import { invoke } from '@tauri-apps/api/core';

const mockGetAgentConfig = vi.fn();
const mockUpdateAgentConfig = vi.fn();
const mockListAllWorkflowsForBackend = vi.fn();
const mockListLlmProfilesForBackend = vi.fn();
const mockGetProviderCapabilities = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const useIsMobile = vi.fn(() => false);
vi.mock('../../../hooks/useMediaQuery', async importOriginal => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, useIsMobile: () => useIsMobile() };
});

vi.mock('../../../utils/platform', async importOriginal => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, isMacOS: vi.fn(() => false) };
});

vi.mock('../../../services/api/servers', () => ({
  getAgentConfig: (...args: unknown[]) => mockGetAgentConfig(...args),
  updateAgentConfig: (...args: unknown[]) => mockUpdateAgentConfig(...args),
}));

vi.mock('../../../features/workflows/api', () => ({
  listAllWorkflowsForBackend: (...args: unknown[]) => mockListAllWorkflowsForBackend(...args),
}));

vi.mock('../../../services/api/llm-profiles', () => ({
  listLlmProfilesForBackend: (...args: unknown[]) => mockListLlmProfilesForBackend(...args),
  getProviderCapabilities: (...args: unknown[]) => mockGetProviderCapabilities(...args),
}));

const LOCAL_PROVIDERS = [
  {
    id: 'prov-supported',
    name: 'Primary',
    providerType: 'zclaudia',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'prov-unsupported',
    name: 'Legacy',
    providerType: 'zclaudia',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

describe('PermissionSettings', () => {
  beforeEach(() => {
    mockGetAgentConfig.mockReset();
    mockUpdateAgentConfig.mockReset();
    mockListAllWorkflowsForBackend.mockReset();
    mockListLlmProfilesForBackend.mockReset();
    mockGetProviderCapabilities.mockReset();
    vi.mocked(isMacOS).mockReturnValue(false);
    useIsMobile.mockReturnValue(false);
    vi.mocked(invoke).mockReset();

    useServerStore.setState({ activeServerId: 'local' } as any);
    useFacadeStore.setState({ localBackendId: 'local', backends: [] } as any);
    useLlmProfileMetaStore.setState({
      providersByBackend: {
        local: LOCAL_PROVIDERS,
      },
    } as any);

    mockGetAgentConfig.mockResolvedValue({
      id: 1,
      enabled: true,
      projectId: null,
      sessionId: null,
      llmProfileId: null,
      permissionWorkflowOverrideId: null,
      permissionPolicy: JSON.stringify({
        enabled: true,
        aiReview: {
          enabled: true,
        },
      }),
    });
    mockUpdateAgentConfig.mockResolvedValue({
      id: 1,
      enabled: true,
      projectId: null,
      sessionId: null,
      llmProfileId: null,
      permissionWorkflowOverrideId: null,
      permissionPolicy: null,
    });
    mockListAllWorkflowsForBackend.mockResolvedValue([]);

    mockGetProviderCapabilities.mockImplementation(async (llmProfileId: string) => ({
      modes: [],
      models: [],
      supportsAIReview: llmProfileId === 'prov-supported',
    }));
    mockListLlmProfilesForBackend.mockResolvedValue([]);
  });

  function findTriggerByText(textFragment: string): HTMLElement {
    const triggers = screen
      .getAllByRole('button')
      .filter(b => b.getAttribute('aria-haspopup') === 'listbox');
    const match = triggers.find(b => b.textContent?.includes(textFragment));
    if (!match) throw new Error(`No Select trigger found containing "${textFragment}"`);
    return match;
  }

  it('only lists providers that support AI review', async () => {
    render(<PermissionSettings />);

    await screen.findByText('Review provider');

    await waitFor(() => {
      expect(mockGetProviderCapabilities).toHaveBeenCalledWith(
        'prov-supported',
        undefined,
        'local'
      );
      expect(mockGetProviderCapabilities).toHaveBeenCalledWith(
        'prov-unsupported',
        undefined,
        'local'
      );
    });

    fireEvent.click(findTriggerByText('Session default'));
    expect(screen.getByRole('option', { name: 'Session default' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Primary (zclaudia)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Legacy (zclaudia)' })).toBeNull();
  });

  it('loads providers from the local backend when provider store is empty', async () => {
    useLlmProfileMetaStore.setState({
      providersByBackend: { local: [] },
    } as any);

    mockListLlmProfilesForBackend.mockResolvedValue([
      {
        id: 'prov-supported',
        name: 'Primary',
        providerType: 'zclaudia',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    render(<PermissionSettings />);

    await waitFor(() => {
      expect(mockListLlmProfilesForBackend).toHaveBeenCalledWith('local');
      expect(mockGetProviderCapabilities).toHaveBeenCalledWith(
        'prov-supported',
        undefined,
        'local'
      );
    });

    fireEvent.click(findTriggerByText('Session default'));
    expect(screen.getByRole('option', { name: 'Primary (zclaudia)' })).toBeInTheDocument();
  });

  it('stays pinned to the local backend when a remote backend is active', async () => {
    useServerStore.setState({ activeServerId: 'remote-1' } as any);
    useFacadeStore.setState({
      localBackendId: 'local',
      backends: [
        { backendId: 'local', isThisInstance: true },
        { backendId: 'remote-1', isThisInstance: false },
      ],
    } as any);

    render(<PermissionSettings />);

    await screen.findByText('Review provider');

    await waitFor(() => {
      expect(mockGetProviderCapabilities).toHaveBeenCalledWith(
        'prov-supported',
        undefined,
        'local'
      );
      expect(mockListAllWorkflowsForBackend).toHaveBeenCalledWith('local');
      expect(mockGetAgentConfig).toHaveBeenCalledWith('local');
    });

    // Target is the local backend, so no target-backend banner is shown.
    expect(screen.queryByTestId('settings-target-backend-banner')).toBeNull();
  });

  it('targets the active backend and shows a banner when no local backend exists', async () => {
    useServerStore.setState({ activeServerId: 'remote-1' } as any);
    useFacadeStore.setState({
      localBackendId: null,
      backends: [{ backendId: 'remote-1', name: 'Work Laptop', isThisInstance: false }],
    } as any);
    useLlmProfileMetaStore.setState({
      providersByBackend: { 'remote-1': LOCAL_PROVIDERS },
    } as any);

    render(<PermissionSettings />);

    await screen.findByText('Review provider');

    const banner = screen.getByTestId('settings-target-backend-banner');
    expect(banner).toHaveTextContent('These settings apply to the connected backend:');
    expect(banner).toHaveTextContent('Work Laptop');

    await waitFor(() => {
      expect(mockGetAgentConfig).toHaveBeenCalledWith('remote-1');
      expect(mockListAllWorkflowsForBackend).toHaveBeenCalledWith('remote-1');
      expect(mockGetProviderCapabilities).toHaveBeenCalledWith(
        'prov-supported',
        undefined,
        'remote-1'
      );
    });
  });

  it('saves policy updates to the resolved target backend', async () => {
    useServerStore.setState({ activeServerId: 'remote-1' } as any);
    useFacadeStore.setState({
      localBackendId: null,
      backends: [{ backendId: 'remote-1', name: 'Work Laptop', isThisInstance: false }],
    } as any);
    useLlmProfileMetaStore.setState({
      providersByBackend: { 'remote-1': LOCAL_PROVIDERS },
    } as any);

    render(<PermissionSettings />);

    const toggle = await screen.findByRole('switch', { name: 'Auto-approve tools' });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockUpdateAgentConfig).toHaveBeenCalledWith(
        expect.objectContaining({ permissionPolicy: expect.any(String) }),
        'remote-1'
      );
    });
  });

  it('renders a disabled notice and makes no requests when no backend exists at all', async () => {
    useServerStore.setState({ activeServerId: null } as any);
    useFacadeStore.setState({ localBackendId: null, backends: [] } as any);

    render(<PermissionSettings />);

    expect(await screen.findByTestId('settings-no-backend-notice')).toBeInTheDocument();
    expect(screen.queryByText('Auto-approve tools')).toBeNull();
    expect(mockGetAgentConfig).not.toHaveBeenCalled();
    expect(mockListAllWorkflowsForBackend).not.toHaveBeenCalled();
  });

  it('falls back to the backends list when localBackendId is not synced yet', async () => {
    useFacadeStore.setState({
      localBackendId: null,
      backends: [{ backendId: 'local', isThisInstance: true }],
    } as any);

    render(<PermissionSettings />);

    await screen.findByText('Review provider');

    await waitFor(() => {
      expect(mockGetProviderCapabilities).toHaveBeenCalledWith(
        'prov-supported',
        undefined,
        'local'
      );
    });
  });

  it('renders the master toggle and grouped sections once loaded', async () => {
    render(<PermissionSettings />);
    expect(await screen.findByText('Auto-approve tools')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Auto-approve tools' })).toBeTruthy();
    // policy defaults to enabled via DEFAULT_UNIFIED_POLICY; grouped sections present:
    expect(screen.getByText('Permission categories')).toBeTruthy();
    expect(screen.getByText('Tool rules')).toBeTruthy();
    expect(screen.getByText('Hooks')).toBeTruthy();
    expect(screen.getByText('Safety guards')).toBeTruthy();
    expect(screen.getByText('File Read')).toBeTruthy();
  });

  it('lists non-system workflows as global override options', async () => {
    mockListAllWorkflowsForBackend.mockResolvedValue([
      {
        id: 'wf-global',
        name: 'Global Review',
        status: 'active',
        definition: { nodes: [], edges: [], entryNodeId: '', triggers: [] },
      },
      {
        id: 'wf-system',
        name: 'System Fallback',
        status: 'active',
        isSystem: true,
        definition: { nodes: [], edges: [], entryNodeId: '', triggers: [] },
      },
      {
        id: 'wf-disabled',
        name: 'Disabled Review',
        status: 'disabled',
        definition: { nodes: [], edges: [], entryNodeId: '', triggers: [] },
      },
    ]);

    render(<PermissionSettings />);

    expect(await screen.findByText('Global override')).toBeInTheDocument();
    fireEvent.click(findTriggerByText('System fallback only'));
    expect(screen.getByRole('option', { name: '[Global] Global Review' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '[Global] System Fallback' })).toBeNull();
    expect(screen.queryByRole('option', { name: '[Global] Disabled Review' })).toBeNull();
  });

  it('names the numeric permission controls', async () => {
    render(<PermissionSettings />);

    await screen.findByText('Review timeout');

    expect(screen.getByLabelText(/review timeout/i)).toBeTruthy();
    expect(screen.getByLabelText(/confidence/i)).toBeTruthy();
    expect(screen.getByLabelText(/rate limit/i)).toBeTruthy();
  });

  it('names the safety guard checkboxes', async () => {
    render(<PermissionSettings />);

    await screen.findByText('Safety guards');

    expect(screen.getByLabelText(/protect sensitive files/i)).toBeTruthy();
    expect(screen.getByLabelText(/enforce workspace scope/i)).toBeTruthy();
  });

  it('keeps the adjudication controls editable on a phone', async () => {
    useIsMobile.mockReturnValue(true);
    render(<PermissionSettings />);

    await screen.findByText('Auto-approve tools');
    expect(screen.getByLabelText('Auto-approve tools')).toBeEnabled();
    expect(screen.getByLabelText(/protect sensitive files/i)).toBeEnabled();
    expect(screen.getByLabelText(/enforce workspace scope/i)).toBeEnabled();
  });

  it('shows tool rules and hooks on a phone without letting them be authored', async () => {
    useIsMobile.mockReturnValue(true);
    render(<PermissionSettings />);

    await screen.findByText('Tool rules');
    expect(screen.getByText('Hooks')).toBeTruthy();
    // The rule/hook DSL inputs and their add/remove affordances are gone.
    expect(screen.queryByPlaceholderText('Bash(git *)')).toBeNull();
    expect(screen.queryByText(/add hook/i)).toBeNull();
    expect(screen.getAllByText(/Edit these on a larger screen/i).length).toBe(2);
  });

  it('collapses the AI review knobs on a phone and opens them on demand', async () => {
    useIsMobile.mockReturnValue(true);
    render(<PermissionSettings />);

    await screen.findByText('Enable AI review');
    expect(screen.getByText('Review tuning')).toBeTruthy();
    expect(screen.queryByLabelText('Review timeout')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByLabelText('Review timeout')).toBeTruthy();
    expect(screen.getByLabelText('Confidence threshold')).toBeTruthy();
    expect(screen.getByLabelText('Rate limit')).toBeTruthy();
  });

  it('leaves the AI review knobs expanded and the lists editable on desktop', async () => {
    render(<PermissionSettings />);

    await screen.findByText('Enable AI review');
    expect(screen.queryByText('Review tuning')).toBeNull();
    expect(screen.getByLabelText('Review timeout')).toBeTruthy();
    expect(screen.getAllByPlaceholderText('Bash(git *)').length).toBeGreaterThan(0);
  });

  it('does not render the System permissions section off macOS', async () => {
    render(<PermissionSettings />);
    await screen.findByText('Auto-approve tools');
    expect(screen.queryByText('System permissions')).toBeNull();
  });

  it('renders macOS system permissions at the top', async () => {
    vi.mocked(isMacOS).mockReturnValue(true);
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'check_full_disk_access') return false;
      if (cmd === 'check_folder_permissions') return [{ name: 'Documents', granted: false }];
      return undefined;
    });

    render(<PermissionSettings />);

    expect(await screen.findByText('System permissions')).toBeTruthy();
    expect(screen.getByText('Full disk access')).toBeTruthy();
    expect(screen.getByText('Folder access')).toBeTruthy();
    expect(screen.getByText('~/Documents')).toBeTruthy();

    // System permissions render above the agent permission settings
    const systemEl = screen.getByText('System permissions');
    const agentEl = screen.getByText('Auto-approve tools');
    expect(
      systemEl.compareDocumentPosition(agentEl) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
