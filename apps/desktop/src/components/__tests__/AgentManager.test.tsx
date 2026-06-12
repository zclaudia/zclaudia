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
  listLlmProfiles: vi.fn(),
  getWorkspaceSkills: vi.fn(),
  getMcpServers: vi.fn(),
  getMcpServerStatuses: vi.fn(),
}));

describe('AgentManager', () => {
  const mockOnClose = vi.fn();

  const mockLlmProfiles = [
    {
      id: 'llm-1',
      name: 'Anthropic Default',
      providerType: 'anthropic' as const,
      isDefault: true,
      // F2: the LLM-profile Save validator now requires at least one model
      // entry. Reflect that in fixtures so the agent dropdown has options.
      models: [
        { modelId: 'claude-sonnet-4-5' },
        { modelId: 'claude-haiku-4-5' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'llm-2',
      name: 'OpenAI',
      providerType: 'openai' as const,
      isDefault: false,
      models: [{ modelId: 'gpt-4o' }],
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
      enabledTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'LS'],
      toolSelection: {
        sets: [{ source: 'builtin', id: 'core-coding' }],
        providers: [],
        include: [],
        exclude: [],
      },
      skillSelection: {
        providers: [{ source: 'workspace' as const }, { source: 'external' as const }, { source: 'plugin' as const }],
        include: [],
        exclude: [],
        pinned: [],
      },
      isDefault: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listAgentProfiles).mockResolvedValue(mockAgents);
    vi.mocked(api.listLlmProfiles).mockResolvedValue(mockLlmProfiles);
    vi.mocked(api.getWorkspaceSkills).mockResolvedValue([
      {
        id: 'coding-guidelines',
        name: 'coding-guidelines',
        description: 'Follow project conventions',
        path: '/skills/coding-guidelines/SKILL.md',
        source: 'workspace',
      },
      {
        id: 'security-audit',
        name: 'security-audit',
        description: 'Audit code',
        path: '/skills/security-audit/SKILL.md',
        source: 'external',
      },
    ]);
    vi.mocked(api.getMcpServers).mockResolvedValue([
      {
        id: 'mcp-1',
        name: 'github',
        command: 'npx',
        args: ['github-mcp'],
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
    vi.mocked(api.getMcpServerStatuses).mockResolvedValue([
      {
        name: 'github',
        state: 'connected',
        enabled: true,
        inventory: { tools: 2, resources: 1, prompts: 0 },
      },
    ]);
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
      expect(api.listLlmProfiles).toHaveBeenCalled();
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
    expect(screen.getByText('Tool Sets')).toBeInTheDocument();
    expect(screen.getByText('Core Coding')).toBeInTheDocument();
    expect(screen.getByText('10 tools')).toBeInTheDocument();
    expect(screen.queryByText('Read a text file with line pagination, size limits, and binary-file protection.')).toBeNull();
    await clickAsync(screen.getByLabelText('expand tool set core-coding'));
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('Read a text file with line pagination, size limits, and binary-file protection.')).toBeInTheDocument();
    expect(screen.getByLabelText('customize tool set core-coding')).toBeInTheDocument();
    expect(screen.queryByLabelText('select tool Bash')).toBeNull();
    expect(screen.getByText('Thinking Level')).toBeInTheDocument();

    // Fill name
    fireEvent.change(screen.getByPlaceholderText(/Default Coding Agent/), {
      target: { value: 'Doc Writer' },
    });

    // F2: Model is a dropdown sourced from the bound LLM profile's models list.
    // Default LLM is pre-selected (Anthropic Default with models [sonnet, haiku]),
    // so we open the Model dropdown and pick claude-sonnet-4-5.
    await clickAsync(screen.getByText('Model *').nextElementSibling as Element);
    await clickAsync(screen.getByText('claude-sonnet-4-5'));

    // Fill systemPrompt
    fireEvent.change(screen.getByPlaceholderText(/You are a helpful coding agent/), {
      target: { value: 'You are a doc writer' },
    });

    // Customize core-coding and remove Bash from the precise selection.
    await clickAsync(screen.getByLabelText('expand tool set core-coding'));
    await clickAsync(screen.getByLabelText('customize tool set core-coding'));
    await clickAsync(screen.getByLabelText('select tool Bash'));

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
          toolSelection: {
            sets: [],
            providers: [],
            include: [
              { source: 'builtin', name: 'Read' },
              { source: 'builtin', name: 'Write' },
              { source: 'builtin', name: 'Edit' },
              { source: 'builtin', name: 'Eval' },
              { source: 'builtin', name: 'Grep' },
              { source: 'builtin', name: 'Glob' },
              { source: 'builtin', name: 'LS' },
              { source: 'builtin', name: 'EnterPlanMode' },
              { source: 'builtin', name: 'ExitPlanMode' },
            ],
            exclude: [],
          },
          enabledTools: ['Read', 'Write', 'Edit', 'Eval', 'Grep', 'Glob', 'LS', 'EnterPlanMode', 'ExitPlanMode'],
          thinkingLevel: 'low',
          isDefault: true,
        })
      );
    });
  });

  it('shows persisted external providers and pinned external tool count in the edit form', async () => {
    vi.mocked(api.listAgentProfiles).mockResolvedValue([
      {
        ...mockAgents[0],
        toolSelection: {
          sets: [{ source: 'builtin', id: 'core-coding' }],
          providers: [{ source: 'mcp', serverId: 'github' }],
          include: [{ source: 'mcp', server: 'github', tool: 'search_repositories' }],
          exclude: [],
        },
      },
    ]);

    await renderAgentManager({ onClose: mockOnClose });

    await waitForFast(() => {
      expect(screen.getByText('Default Coding Agent')).toBeInTheDocument();
    });

    await clickAsync(screen.getAllByTitle('Edit')[0]);

    expect(screen.getByText('External Tool Providers')).toBeInTheDocument();
    expect(screen.getByText('mcp/github')).toBeInTheDocument();
    expect(screen.getByText('1 pinned external tool')).toBeInTheDocument();
  });

  it('adds configured MCP providers from the profile editor', async () => {
    vi.mocked(api.listAgentProfiles).mockResolvedValue([
      {
        ...mockAgents[0],
        toolSelection: {
          sets: [{ source: 'builtin', id: 'core-coding' }],
          providers: [],
          include: [],
          exclude: [],
        },
      },
    ]);

    await renderAgentManager();
    await waitForFast(() => expect(screen.getByText('Default Coding Agent')).toBeInTheDocument());
    await clickAsync(screen.getAllByTitle('Edit')[0]);

    expect(screen.getByText('mcp/github')).toBeInTheDocument();
    expect(screen.getByText('tools 2 | resources 1 | prompts 0')).toBeInTheDocument();
    await clickAsync(screen.getByText('Add'));
    await clickAsync(screen.getByText('Update'));

    await waitForFast(() => {
      expect(api.updateAgentProfile).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          toolSelection: expect.objectContaining({
            providers: [{ source: 'mcp', serverId: 'github' }],
          }),
        }),
      );
    });
  });

  it('shows MCP provider trust summary in the profile editor', async () => {
    vi.mocked(api.getMcpServers).mockResolvedValue([
      {
        id: 'mcp-1',
        name: 'github',
        command: 'npx',
        args: ['github-mcp'],
        enabled: true,
        trustPolicy: {
          trustLevel: 'trusted-readonly',
          trustReadOnlyHint: true,
          defaultRiskAction: 'ask',
          riskActions: { high: 'deny' },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    await renderAgentManager({ onClose: mockOnClose });
    await waitForFast(() => expect(screen.getByText('Default Coding Agent')).toBeInTheDocument());
    await clickAsync(screen.getAllByTitle('Edit')[0]);

    expect(screen.getByText('trust trusted-readonly')).toBeInTheDocument();
    expect(screen.getByText('default ask')).toBeInTheDocument();
    expect(screen.getByText('readonly hints trusted')).toBeInTheDocument();
    expect(screen.getByText('high deny')).toBeInTheDocument();
  });

  it('edits skill selection sources and pinned inline skills', async () => {
    vi.mocked(api.listAgentProfiles).mockResolvedValue([
      {
        ...mockAgents[0],
        skillSelection: {
          providers: [{ source: 'workspace' }],
          include: [],
          exclude: [],
          pinned: [],
        },
      },
    ]);

    await renderAgentManager({ onClose: mockOnClose });

    await waitForFast(() => {
      expect(screen.getByText('Default Coding Agent')).toBeInTheDocument();
    });

    await clickAsync(screen.getAllByTitle('Edit')[0]);

    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('coding-guidelines')).toBeInTheDocument();
    expect(screen.getByText('security-audit')).toBeInTheDocument();

    await clickAsync(screen.getByLabelText('enable external skills'));
    fireEvent.change(screen.getByLabelText('skill visibility external:security-audit'), {
      target: { value: 'include' },
    });
    await clickAsync(screen.getByLabelText('pin skill external:security-audit'));
    await clickAsync(screen.getByText('Update'));

    await waitForFast(() => {
      expect(api.updateAgentProfile).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          skillSelection: {
            providers: [{ source: 'workspace' }, { source: 'external' }],
            include: [{ source: 'external', id: 'security-audit' }],
            exclude: [],
            pinned: [{ source: 'external', id: 'security-audit' }],
          },
        }),
      );
    });
  });

  it('edits skill execution policy overrides', async () => {
    vi.mocked(api.listAgentProfiles).mockResolvedValue([
      {
        ...mockAgents[0],
        skillExecution: {
          overrides: [
            {
              ref: { source: 'workspace', id: 'coding-guidelines' },
              defaultMode: 'inline',
            },
          ],
        },
      },
    ]);

    await renderAgentManager({ onClose: mockOnClose });

    await waitForFast(() => {
      expect(screen.getByText('Default Coding Agent')).toBeInTheDocument();
    });

    await clickAsync(screen.getAllByTitle('Edit')[0]);

    expect(screen.getByText('1 policy overrides')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('skill default mode external:security-audit'), {
      target: { value: 'fork' },
    });
    await clickAsync(screen.getByLabelText('allow fork skill external:security-audit'));
    fireEvent.change(screen.getByLabelText('skill fork tool policy external:security-audit'), {
      target: { value: 'web' },
    });
    await clickAsync(screen.getByText('Update'));

    await waitForFast(() => {
      expect(api.updateAgentProfile).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          skillExecution: {
            overrides: [
              {
                ref: { source: 'workspace', id: 'coding-guidelines' },
                defaultMode: 'inline',
              },
              {
                ref: { source: 'external', id: 'security-audit' },
                allowedModes: ['fork'],
                defaultMode: 'fork',
                forkToolPolicy: 'web',
              },
            ],
          },
        }),
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

  describe('Model dropdown', () => {
    it('renders the bound LLM profile model entries as dropdown options', async () => {
      // F2: Model is now a <select>-style dropdown driven by the bound LLM
      // profile's models list. Opening the dropdown should surface each
      // entry; the default profile here declares two.
      await renderAgentManager({ onClose: mockOnClose });

      await waitForFast(() => {
        expect(screen.getByText('Default Coding Agent')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Agent'));

      // Open the Model dropdown — labelled "Model *", trigger is the sibling
      // button rendered by ModelSelector.
      await clickAsync(screen.getByText('Model *').nextElementSibling as Element);

      expect(screen.getByText('claude-sonnet-4-5')).toBeInTheDocument();
      expect(screen.getByText('claude-haiku-4-5')).toBeInTheDocument();
    });

    it('disables the Model dropdown and shows the empty-state copy when bound profile has no models', async () => {
      // Legacy / degraded path: a historical LLM profile created before the
      // F2 requirement might still have an empty models list. We surface a
      // disabled dropdown with explanatory copy rather than silently letting
      // the user type a free-text id.
      vi.mocked(api.listLlmProfiles).mockResolvedValue([
        {
          ...mockLlmProfiles[0],
          models: [],
        },
      ]);

      await renderAgentManager({ onClose: mockOnClose });

      await waitForFast(() => {
        expect(screen.getByText('Default Coding Agent')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Agent'));

      expect(
        screen.getByText(/No models available — declare models on the LLM profile/i),
      ).toBeInTheDocument();
      const modelBtn = screen.getByText(/No models available — declare models on the LLM profile/i).closest('button');
      expect(modelBtn).toBeDisabled();
    });

    it('warns (soft warning) when the persisted model id is not in the bound LLM profile list', async () => {
      // The soft warning still fires for historical agent profiles whose
      // model id no longer matches the LLM profile's current models list.
      vi.mocked(api.listAgentProfiles).mockResolvedValue([
        {
          ...mockAgents[0],
          model: 'claude-haiku-4-5',  // declared on llm-1
        },
      ]);
      vi.mocked(api.listLlmProfiles).mockResolvedValue([
        {
          ...mockLlmProfiles[0],
          models: [{ modelId: 'claude-opus-4-7' }],  // doesn't contain haiku
        },
        mockLlmProfiles[1],
      ]);

      await renderAgentManager({ onClose: mockOnClose });

      await waitForFast(() => {
        expect(screen.getByText('Default Coding Agent')).toBeInTheDocument();
      });

      // Open the existing agent's edit form so the persisted model populates.
      await clickAsync(screen.getAllByTitle('Edit')[0]);

      await waitForFast(() => {
        expect(
          screen.getByText(/not declared on the selected LLM profile/i),
        ).toBeInTheDocument();
      });
    });
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
