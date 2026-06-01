import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AgentManager } from '../../features/settings/AgentManager';
import * as api from '../../services/api';

const ASYNC_TIMEOUT = 200;
const waitForFast = (assertion: Parameters<typeof waitFor>[0]) =>
  waitFor(assertion, { timeout: ASYNC_TIMEOUT });

async function renderAgentManager(props: Partial<Parameters<typeof AgentManager>[0]> = {}) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<AgentManager isOpen={true} onClose={vi.fn()} {...props} />);
    await Promise.resolve();
  });
  return view;
}

async function clickAsync(target: Element) {
  await act(async () => {
    fireEvent.click(target);
    await Promise.resolve();
  });
}

const mockServerState = {
  activeServerId: 'local',
};

const mockFacadeState = {
  connectionState: 'connected',
  backends: [{ backendId: 'local', runtimeState: 'ready' }],
};

vi.mock('../../stores/serverStore', () => ({
  useServerStore: vi.fn((selector?: (state: typeof mockServerState) => unknown) => (
    typeof selector === 'function' ? selector(mockServerState) : mockServerState
  )),
}));

vi.mock('../../stores/facadeStore', () => ({
  useFacadeStore: vi.fn((selector?: (state: typeof mockFacadeState) => unknown) => (
    typeof selector === 'function' ? selector(mockFacadeState) : mockFacadeState
  )),
}));

vi.mock('../../hooks/useAndroidBack', () => ({
  useAndroidBack: vi.fn(),
}));

vi.mock('../../services/api', () => ({
  listAgentProfiles: vi.fn(),
  createAgentProfile: vi.fn(),
  updateAgentProfile: vi.fn(),
  deleteAgentProfile: vi.fn(),
  setDefaultAgentProfile: vi.fn(),
  getProviders: vi.fn(),
}));

describe('AgentManager', () => {
  const mockOnClose = vi.fn();

  const mockLlmProfiles = [
    {
      id: 'llm-1',
      name: 'Anthropic Default',
      providerType: 'anthropic' as const,
      isDefault: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'llm-2',
      name: 'OpenAI',
      providerType: 'openai' as const,
      isDefault: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];

  const mockAgents = [
    {
      id: 'agent-1',
      name: 'Default Coding Agent',
      description: 'Default agent for coding tasks',
      llmProfileId: 'llm-1',
      model: 'claude-sonnet-4-5',
      systemPrompt: 'You are a coding agent.',
      enabledTools: ['read', 'write', 'edit', 'bash'],
      isDefault: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listAgentProfiles).mockResolvedValue(mockAgents);
    vi.mocked(api.getProviders).mockResolvedValue(mockLlmProfiles);
    vi.mocked(api.createAgentProfile).mockResolvedValue(mockAgents[0]);
    vi.mocked(api.updateAgentProfile).mockResolvedValue(mockAgents[0]);
    vi.mocked(api.deleteAgentProfile).mockResolvedValue(undefined);
    vi.mocked(api.setDefaultAgentProfile).mockResolvedValue(mockAgents[0]);
    mockServerState.activeServerId = 'local';
    mockFacadeState.connectionState = 'connected';
    mockFacadeState.backends = [{ backendId: 'local', runtimeState: 'ready' }];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when not open', () => {
    const { container } = render(<AgentManager isOpen={false} onClose={mockOnClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders agent list and Add Agent button on open', async () => {
    await renderAgentManager({ onClose: mockOnClose });

    await waitForFast(() => {
      expect(api.listAgentProfiles).toHaveBeenCalled();
      expect(api.getProviders).toHaveBeenCalled();
    });

    expect(screen.getByText('Agent Management')).toBeInTheDocument();
    expect(screen.getByText('Default Coding Agent')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByText('Add Agent')).toBeInTheDocument();
  });

  it('shows "Connect to a server first" when disconnected', async () => {
    mockFacadeState.connectionState = 'idle';
    mockFacadeState.backends = [];

    await renderAgentManager({ onClose: mockOnClose });

    expect(screen.getByText('Connect to a server first')).toBeInTheDocument();
    expect(api.listAgentProfiles).not.toHaveBeenCalled();
  });

  it('shows empty state when no agents', async () => {
    vi.mocked(api.listAgentProfiles).mockResolvedValue([]);

    await renderAgentManager({ onClose: mockOnClose });

    await waitForFast(() => {
      expect(screen.getByText(/No agents configured/)).toBeInTheDocument();
    });
  });

  it('submits new agent profile body shape on save', async () => {
    await renderAgentManager({ onClose: mockOnClose });

    await waitForFast(() => {
      expect(screen.getByText('Default Coding Agent')).toBeInTheDocument();
    });

    await clickAsync(screen.getByText('Add Agent'));

    // Form fields appear
    expect(screen.getByText('Name *')).toBeInTheDocument();
    expect(screen.getByText('LLM Profile *')).toBeInTheDocument();
    expect(screen.getByText('Model *')).toBeInTheDocument();
    expect(screen.getByText('System Prompt')).toBeInTheDocument();
    expect(screen.getByText('Enabled Tools')).toBeInTheDocument();
    expect(screen.getByText('Thinking Level')).toBeInTheDocument();

    // Fill name
    fireEvent.change(screen.getByPlaceholderText(/Default Coding Agent/), {
      target: { value: 'Doc Writer' },
    });

    // Default LLM should be pre-selected (Anthropic Default), so we don't need to pick.
    // Fill model
    fireEvent.change(screen.getByPlaceholderText(/claude-sonnet-4-5/), {
      target: { value: 'claude-sonnet-4-5' },
    });

    // Fill systemPrompt
    fireEvent.change(screen.getByPlaceholderText(/You are a helpful coding agent/), {
      target: { value: 'You are a doc writer' },
    });

    // Pick enabledTools subset: read + edit (toggle on)
    await clickAsync(screen.getByLabelText('enable tool read'));
    await clickAsync(screen.getByLabelText('enable tool edit'));

    // Pick thinkingLevel = "low"
    await clickAsync(screen.getByText('Thinking Level').nextElementSibling as Element);
    await clickAsync(screen.getByText('low'));

    // isDefault checkbox
    await clickAsync(screen.getByLabelText('Set as default agent'));

    await clickAsync(screen.getByText('Create'));

    await waitForFast(() => {
      expect(api.createAgentProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Doc Writer',
          llmProfileId: 'llm-1',
          model: 'claude-sonnet-4-5',
          systemPrompt: 'You are a doc writer',
          enabledTools: ['read', 'edit'],
          thinkingLevel: 'low',
          isDefault: true,
        })
      );
    });
  });

  it('shows inline error and skips API call when delete fails with 409 in-use message', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(api.deleteAgentProfile).mockRejectedValueOnce(
      new Error('Cannot delete agent profile: 1 active session still references it')
    );

    await renderAgentManager({ onClose: mockOnClose });

    await waitForFast(() => {
      expect(screen.getByText('Default Coding Agent')).toBeInTheDocument();
    });

    const deleteButton = screen.getAllByTitle('Delete')[0];
    await clickAsync(deleteButton);
    // first click only arms confirmation
    expect(api.deleteAgentProfile).not.toHaveBeenCalled();
    await clickAsync(deleteButton);

    await waitForFast(() => {
      expect(api.deleteAgentProfile).toHaveBeenCalledWith('agent-1');
      expect(
        screen.getByText(/Cannot delete agent profile: 1 active session still references it/)
      ).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it('calls setDefaultAgentProfile when non-default agent gets "Set as default" click', async () => {
    vi.mocked(api.listAgentProfiles).mockResolvedValue([
      mockAgents[0],
      {
        id: 'agent-2',
        name: 'Doc Writer',
        llmProfileId: 'llm-1',
        model: 'claude-sonnet-4-5',
        systemPrompt: 'You are a doc writer',
        enabledTools: ['read', 'write', 'edit'],
        isDefault: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    await renderAgentManager({ onClose: mockOnClose });

    await waitForFast(() => {
      expect(screen.getByText('Doc Writer')).toBeInTheDocument();
    });

    const setDefaultButtons = screen.getAllByTitle('Set as default');
    await clickAsync(setDefaultButtons[0]);

    expect(api.setDefaultAgentProfile).toHaveBeenCalledWith('agent-2');
  });
});
