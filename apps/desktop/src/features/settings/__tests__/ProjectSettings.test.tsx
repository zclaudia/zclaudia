// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ProjectSettings } from '../ProjectSettings';
import { useServerStore } from '../../../stores/serverStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useLlmProfileMetaStore } from '../../../stores/llmProfileMetaStore';
import { useAgentProfileMetaStore } from '../../../stores/agentProfileMetaStore';
import { useRecoveryStore } from '../../../stores/recoveryStore';
import { useFacadeStore } from '../../../stores/facadeStore';
import { useSupervisionStore } from '../../../stores/supervisionStore';
import { isAndroid } from '../../../utils/platform';

vi.mock('../../../utils/platform', async importOriginal => {
  const mod = await importOriginal<Record<string, any>>();
  return {
    ...mod,
    isAndroid: vi.fn(() => false),
  };
});

vi.mock('../../../services/api', () => ({
  listLlmProfiles: vi.fn(() => new Promise(() => {})),
  updateProject: vi.fn().mockResolvedValue({}),
  getSupervisionAgent: vi.fn(() => new Promise(() => {})),
  initSupervisionAgent: vi.fn().mockResolvedValue({}),
  updateSupervisionAgentAction: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../workflows/api', () => ({
  listAllWorkflows: vi.fn().mockResolvedValue([]),
}));

const mockProject = {
  id: 'proj-1',
  name: 'Test Project',
  rootPath: '/home/user/test',
  defaultAgentProfileId: '',
  reviewLlmProfileId: '',
  permissionWorkflowOverrideId: '',
  systemPrompt: '',
  isInternal: false,
  agentPermissionOverride: null,
};

async function renderProjectSettings(props: Partial<Parameters<typeof ProjectSettings>[0]> = {}) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <ProjectSettings project={mockProject as any} isOpen={true} onClose={() => {}} {...props} />
    );
    await Promise.resolve();
  });
  return view;
}

describe('ProjectSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useServerStore.setState({
      activeServerId: 'local',
      connections: {
        local: { status: 'connected', error: null, isLocalConnection: true, features: [] },
      },
    } as any);
    useRecoveryStore.setState({
      backends: {
        local: { status: 'ready' },
      },
    } as any);
    useFacadeStore.setState({
      connectionState: 'connected',
      backends: [{ backendId: 'local', runtimeState: 'ready', name: 'Local' }],
    } as any);
    vi.mocked(isAndroid).mockReturnValue(false);

    useLlmProfileMetaStore.setState({
      providersByBackend: {},
      providerCommands: {},
      providerCapabilities: {},
    } as any);

    useAgentProfileMetaStore.setState({
      profiles: {},
      loaded: true,
      loading: false,
      loadAll: vi.fn().mockResolvedValue(undefined),
    } as any);

    useProjectStore.setState({
      providers: [],
      updateProject: vi.fn(),
      setProviders: vi.fn(),
    } as any);

    useSupervisionStore.setState({
      agents: {},
      tasks: {},
      lastCheckpoint: {},
      setAgent: vi.fn(),
      removeAgent: vi.fn(),
    } as any);
  });

  it('labels the project name input and the close button', async () => {
    await renderProjectSettings();
    expect(screen.getByLabelText(/project name/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /close/i })).toBeTruthy();
  });

  it('exposes dialog semantics with an accessible name', async () => {
    await renderProjectSettings();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe('Project Settings');
  });
});
