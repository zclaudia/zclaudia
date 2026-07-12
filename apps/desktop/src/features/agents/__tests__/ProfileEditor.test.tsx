// @vitest-environment jsdom
import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { AgentProfileConfig, LlmProfileConfig } from '@zclaudia/shared';

import { ProfileEditor } from '../ProfileEditor';
import * as api from '../../../services/api';
import { useRuntimeDescriptorStore } from '../../../stores/runtimeDescriptorStore';

const RUNTIME_DESCRIPTORS = [
  {
    runtime: 'zclaudia',
    label: 'ZClaudia',
    enabled: true,
    model: { kind: 'llm-profile' as const, multimodalFallback: true, thinkingLevel: 'selectable' as const },
    hasCliPath: false,
    capabilities: {
      tools: 'profile' as const,
      providers: 'profile' as const,
      skills: 'profile' as const,
    },
  },
  {
    runtime: 'claude',
    label: 'Claude',
    enabled: true,
    model: { kind: 'none' as const, multimodalFallback: false, thinkingLevel: 'auto' as const },
    hasCliPath: true,
    capabilities: {
      tools: 'native-readonly' as const,
      providers: 'external' as const,
      skills: 'external' as const,
    },
    authNote:
      'Claude uses the Claude Agent SDK runtime. MCP servers and skills come from ~/.claude; built-in tool sets are not injected.',
  },
];

const GENERIC_NATIVE_DESCRIPTOR = {
  runtime: 'gennative',
  label: 'Generic Native',
  enabled: true,
  model: { kind: 'native' as const, multimodalFallback: false, thinkingLevel: 'selectable' as const },
  hasCliPath: false,
  capabilities: {
    tools: 'native-readonly' as const,
    providers: 'external' as const,
    skills: 'external' as const,
  },
};

vi.mock('../../../services/api', () => ({
  listLlmProfilesForBackend: vi.fn(),
  getWorkspaceSkillsForBackend: vi.fn(),
  getMcpServersForBackend: vi.fn(),
  getMcpServerStatusesForBackend: vi.fn(),
  createAgentProfileForBackend: vi.fn(),
  updateAgentProfileForBackend: vi.fn(),
  deleteAgentProfileForBackend: vi.fn(),
  listAgentProfilesForBackend: vi.fn(),
}));

vi.mock('../../../stores/confirmDialogStore', () => ({
  confirm: vi.fn().mockResolvedValue(true),
}));

const llmProfile: LlmProfileConfig = {
  id: 'lp1',
  name: 'Anthropic',
  providerType: 'anthropic',
  models: [{ modelId: 'claude-sonnet-4-6', displayName: 'Sonnet' }],
  isDefault: true,
  createdAt: 0,
  updatedAt: 0,
};

function makeProfile(id: string, name: string): AgentProfileConfig {
  return {
    id,
    name,
    llmProfileId: 'lp1',
    model: 'claude-sonnet-4-6',
    systemPrompt: '',
    enabledTools: [],
    isDefault: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

const NAME_PLACEHOLDER = 'e.g., Default Coding Agent';

async function renderEditor(profile: AgentProfileConfig | null) {
  const onSaved = vi.fn();
  const onDeleted = vi.fn();
  const view = render(
    <ProfileEditor
      backendId="b1"
      profile={profile}
      onBack={vi.fn()}
      onSaved={onSaved}
      onDeleted={onDeleted}
    />
  );
  // Wait for the catalog load to settle and the form to render.
  await screen.findByPlaceholderText(NAME_PLACEHOLDER);
  return { onSaved, onDeleted, ...view };
}

describe('ProfileEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listLlmProfilesForBackend).mockResolvedValue([llmProfile]);
    vi.mocked(api.getWorkspaceSkillsForBackend).mockResolvedValue([]);
    vi.mocked(api.getMcpServersForBackend).mockResolvedValue([]);
    vi.mocked(api.getMcpServerStatusesForBackend).mockResolvedValue([]);
    // ProfileEditor reads runtime descriptors for its backendId ('b1') from the store.
    useRuntimeDescriptorStore.setState({ byBackend: {} });
    useRuntimeDescriptorStore.getState().setDescriptors(RUNTIME_DESCRIPTORS, 'b1');
  });

  it('loads supporting catalogs for the given backendId', async () => {
    await renderEditor(null);

    expect(api.listLlmProfilesForBackend).toHaveBeenCalledWith('b1');
    await waitFor(() => {
      expect(api.getWorkspaceSkillsForBackend).toHaveBeenCalledWith('b1');
      expect(api.getMcpServersForBackend).toHaveBeenCalledWith('b1');
      expect(api.getMcpServerStatusesForBackend).toHaveBeenCalledWith('b1');
    });
  });

  it('renders as a compact centered editor', async () => {
    await renderEditor(null);

    const editor = screen.getByTestId('agent-profile-editor');
    expect(editor.className).toContain('mx-auto');
    expect(editor.className).toContain('max-w-[760px]');
  });

  it('uses an Agent Type dropdown for runtime selection', async () => {
    await renderEditor(null);

    expect(screen.getByLabelText('Agent Type')).toHaveTextContent('ZClaudia');
  });

  it('create mode: saves via createAgentProfileForBackend and fires onSaved', async () => {
    const saved = makeProfile('new1', 'My Agent');
    vi.mocked(api.createAgentProfileForBackend).mockResolvedValue(saved);

    const { onSaved } = await renderEditor(null);

    fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
      target: { value: 'My Agent' },
    });

    // LLM profile is pre-selected (default profile); pick a model.
    fireEvent.click(screen.getByText('Select a model'));
    fireEvent.click(screen.getByText('Sonnet'));

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(api.createAgentProfileForBackend).toHaveBeenCalledWith(
        'b1',
        expect.objectContaining({
          name: 'My Agent',
          llmProfileId: 'lp1',
          model: 'claude-sonnet-4-6',
        })
      );
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(saved);
    });
    expect(api.updateAgentProfileForBackend).not.toHaveBeenCalled();
  });

  it('create mode: includes the selected runtime type in the save payload', async () => {
    const saved = { ...makeProfile('new1', 'Claude Agent'), runtimeType: 'claude' as const };
    vi.mocked(api.createAgentProfileForBackend).mockResolvedValue(saved);

    await renderEditor(null);

    fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
      target: { value: 'Claude Agent' },
    });
    fireEvent.click(screen.getByLabelText('Agent Type'));
    fireEvent.click(screen.getByRole('button', { name: 'Claude' }));

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(api.createAgentProfileForBackend).toHaveBeenCalledWith(
        'b1',
        expect.objectContaining({
          name: 'Claude Agent',
          runtimeType: 'claude',
          model: '',
        })
      );
    });
  });

  it('create mode completes under React StrictMode', async () => {
    const saved = { ...makeProfile('new1', 'Claude Agent'), runtimeType: 'claude' as const };
    vi.mocked(api.createAgentProfileForBackend).mockResolvedValue(saved);
    const onSaved = vi.fn();

    render(
      <StrictMode>
        <ProfileEditor
          backendId="b1"
          profile={null}
          onBack={vi.fn()}
          onSaved={onSaved}
          onDeleted={vi.fn()}
        />
      </StrictMode>
    );
    await screen.findByPlaceholderText(NAME_PLACEHOLDER);

    fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
      target: { value: 'Claude Agent' },
    });
    fireEvent.click(screen.getByLabelText('Agent Type'));
    fireEvent.click(screen.getByRole('button', { name: 'Claude' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(saved);
    });
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });

  it('shows Claude runtime limitations when Claude is selected', async () => {
    await renderEditor(null);

    expect(screen.queryByText(/Claude Agent SDK/)).toBeNull();
    expect(screen.getByText('Multimodal fallback')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Agent Type'));
    fireEvent.click(screen.getByRole('button', { name: 'Claude' }));

    expect(screen.getByText(/Claude Agent SDK/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /MCP servers and skills come from ~\/\.claude; built-in tool sets are not injected/
      )
    ).toBeInTheDocument();
    expect(screen.queryByText('Multimodal fallback')).toBeNull();
  });

  it('does not save multimodal fallback config for Claude runtime', async () => {
    const visionProfile: LlmProfileConfig = {
      ...llmProfile,
      id: 'vision-lp',
      name: 'Vision',
      models: [
        {
          modelId: 'vision-model',
          displayName: 'Vision Model',
          inputModalities: ['image'],
        },
      ],
    };
    vi.mocked(api.listLlmProfilesForBackend).mockResolvedValue([llmProfile, visionProfile]);
    vi.mocked(api.createAgentProfileForBackend).mockResolvedValue({
      ...makeProfile('new1', 'Claude Agent'),
      runtimeType: 'claude',
    });

    await renderEditor(null);

    fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
      target: { value: 'Claude Agent' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add fallback model' }));
    fireEvent.change(screen.getByLabelText('Fallback LLM Profile'), {
      target: { value: 'vision-lp' },
    });
    fireEvent.change(screen.getByLabelText('Fallback Model'), {
      target: { value: 'vision-model' },
    });
    fireEvent.click(screen.getByLabelText('Agent Type'));
    fireEvent.click(screen.getByRole('button', { name: 'Claude' }));

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(api.createAgentProfileForBackend).toHaveBeenCalledWith(
        'b1',
        expect.objectContaining({
          runtimeType: 'claude',
          model: '',
          multimodalFallback: undefined,
        })
      );
    });
  });

  it('multimodal fallback: opens via Add, sets fields, removes to clear', async () => {
    const visionProfile: LlmProfileConfig = {
      ...llmProfile,
      id: 'vision-lp',
      name: 'Vision',
      models: [
        { modelId: 'vision-model', displayName: 'Vision Model', inputModalities: ['image'] },
      ],
    };
    vi.mocked(api.listLlmProfilesForBackend).mockResolvedValue([llmProfile, visionProfile]);
    await renderEditor(null);

    // Collapsed by default in create mode: the fallback selects are not mounted.
    expect(screen.queryByLabelText('Fallback LLM Profile')).toBeNull();

    // Open it.
    fireEvent.click(screen.getByRole('button', { name: 'Add fallback model' }));
    expect(screen.getByLabelText('Fallback LLM Profile')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Fallback LLM Profile'), {
      target: { value: 'vision-lp' },
    });
    fireEvent.change(screen.getByLabelText('Fallback Model'), {
      target: { value: 'vision-model' },
    });
    expect(screen.getByLabelText('Fallback Model')).toHaveValue('vision-model');

    // Remove collapses and clears the selects.
    fireEvent.click(screen.getByRole('button', { name: 'Remove fallback' }));
    expect(screen.queryByLabelText('Fallback LLM Profile')).toBeNull();
  });

  it('edit mode: a profile with an existing fallback opens expanded', async () => {
    const visionProfile: LlmProfileConfig = {
      ...llmProfile,
      id: 'vision-lp',
      name: 'Vision',
      models: [
        { modelId: 'vision-model', displayName: 'Vision Model', inputModalities: ['image'] },
      ],
    };
    vi.mocked(api.listLlmProfilesForBackend).mockResolvedValue([llmProfile, visionProfile]);
    const existing: AgentProfileConfig = {
      ...makeProfile('p1', 'Coding'),
      multimodalFallback: { llmProfileId: 'vision-lp', model: 'vision-model' },
    };
    await renderEditor(existing);

    // Expanded by default (no Add button; selects visible with the saved values).
    expect(screen.queryByRole('button', { name: 'Add fallback model' })).toBeNull();
    expect(screen.getByLabelText('Fallback LLM Profile')).toHaveValue('vision-lp');
    expect(screen.getByLabelText('Fallback Model')).toHaveValue('vision-model');
  });

  it('edit mode: autosaves an edit via updateAgentProfileForBackend (no Update button)', async () => {
    vi.useFakeTimers();
    try {
      const existing = makeProfile('p1', 'Coding');
      const saved = { ...existing, name: 'Coding 2' };
      vi.mocked(api.updateAgentProfileForBackend).mockResolvedValue(saved);

      const onSaved = vi.fn();
      render(
        <ProfileEditor
          backendId="b1"
          profile={existing}
          onBack={vi.fn()}
          onSaved={onSaved}
          onDeleted={vi.fn()}
        />
      );
      // catalog load resolves on fake timers
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // No Update button in edit mode.
      expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();

      fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
        target: { value: 'Coding 2' },
      });

      // Debounce window elapses → one autosave.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(api.updateAgentProfileForBackend).toHaveBeenCalledWith(
        'b1',
        'p1',
        expect.objectContaining({ name: 'Coding 2' })
      );
      expect(onSaved).toHaveBeenCalledWith(saved);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opening an existing profile does not trigger a phantom autosave', async () => {
    vi.useFakeTimers();
    try {
      const existing = makeProfile('p1', 'Coding');
      vi.mocked(api.updateAgentProfileForBackend).mockResolvedValue(existing);

      render(
        <ProfileEditor
          backendId="b1"
          profile={existing}
          onBack={vi.fn()}
          onSaved={vi.fn()}
          onDeleted={vi.fn()}
        />
      );

      // Catalog load + form hydration settle, then well past the debounce window.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      // No user edit happened, so the form is not dirty — nothing should persist.
      expect(api.updateAgentProfileForBackend).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Capabilities tab defaults to the Tools sub-panel with tool sets visible', async () => {
    const { queryAllByLabelText } = await renderEditor(null);

    fireEvent.click(screen.getByRole('tab', { name: /Capabilities/ }));

    // Tools is the default sub-panel — the built-in tool set checkboxes render immediately.
    expect(queryAllByLabelText(/enable full tool set/).length).toBeGreaterThan(0);
  });

  it('Capabilities sub-tabs switch between Tools, Providers, and Skills', async () => {
    const { queryAllByLabelText } = await renderEditor(null);

    fireEvent.click(screen.getByRole('tab', { name: /Capabilities/ }));

    // Tools panel: tool set checkboxes present; providers heading absent.
    expect(queryAllByLabelText(/enable full tool set/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Configured MCP servers')).toBeNull();

    // Switch to Providers.
    fireEvent.click(screen.getByRole('tab', { name: /Providers/ }));
    expect(screen.getByText('Configured MCP servers')).toBeInTheDocument();
    expect(queryAllByLabelText(/enable full tool set/)).toHaveLength(0);

    // Switch to Skills.
    fireEvent.click(screen.getByRole('tab', { name: /Skills/ }));
    expect(screen.getByLabelText('enable workspace skills')).toBeInTheDocument();
    expect(screen.queryByText('Configured MCP servers')).toBeNull();
  });

  it('Claude runtime shows read-only capability notes instead of editable panels', async () => {
    const { queryAllByLabelText } = await renderEditor(null);

    fireEvent.click(screen.getByLabelText('Agent Type'));
    fireEvent.click(screen.getByRole('button', { name: 'Claude' }));
    fireEvent.click(screen.getByRole('tab', { name: /Capabilities/ }));

    // Tools: native read-only note, no editable checkboxes.
    expect(queryAllByLabelText(/enable full tool set/)).toHaveLength(0);
    expect(screen.getByText(/built-in tool sets are not injected/i)).toBeInTheDocument();

    // Providers: external note.
    fireEvent.click(screen.getByRole('tab', { name: /Providers/ }));
    expect(screen.queryByText('Configured MCP servers')).toBeNull();
    expect(screen.getAllByText(/managed by ~\/\.claude/i).length).toBeGreaterThan(0);

    // Skills: external note.
    fireEvent.click(screen.getByRole('tab', { name: /Skills/ }));
    expect(screen.queryByLabelText('enable workspace skills')).toBeNull();
    expect(screen.getAllByText(/managed by ~\/\.claude/i).length).toBeGreaterThan(0);
  });

  it('edit mode: ⋯ menu Delete confirms then calls deleteAgentProfileForBackend + onDeleted', async () => {
    const { confirm } = await import('../../../stores/confirmDialogStore');
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(api.deleteAgentProfileForBackend).mockResolvedValue({ ok: true });

    const onDeleted = vi.fn();
    const view = render(
      <ProfileEditor
        backendId="b1"
        profile={makeProfile('p1', 'Coding')}
        onBack={vi.fn()}
        onSaved={vi.fn()}
        onDeleted={onDeleted}
      />
    );
    await screen.findByPlaceholderText(NAME_PLACEHOLDER);

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete profile' }));

    await waitFor(() => {
      expect(api.deleteAgentProfileForBackend).toHaveBeenCalledWith('b1', 'p1');
    });
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalled();
    });
    view.unmount();
  });

  it('edit mode: delete when agent is referenced archives it (signals onSaved with read-only profile)', async () => {
    const { confirm } = await import('../../../stores/confirmDialogStore');
    vi.mocked(confirm).mockResolvedValue(true);
    // Server reports the profile was archived (referenced by active sessions).
    vi.mocked(api.deleteAgentProfileForBackend).mockResolvedValue({
      ok: true,
      archived: true,
      sessionCount: 2,
    });
    // Refresh after archive returns the profile now marked read-only.
    vi.mocked(api.listAgentProfilesForBackend).mockResolvedValue([
      { ...makeProfile('p1', 'Coding'), status: 'readonly' },
    ]);

    const onSaved = vi.fn();
    const onDeleted = vi.fn();
    const view = render(
      <ProfileEditor
        backendId="b1"
        profile={makeProfile('p1', 'Coding')}
        onBack={vi.fn()}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    );
    await screen.findByPlaceholderText(NAME_PLACEHOLDER);

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete profile' }));

    // Archived → onSaved fires with the refreshed (read-only) profile, NOT onDeleted.
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'p1', status: 'readonly' })
      );
    });
    expect(onDeleted).not.toHaveBeenCalled();
    view.unmount();
  });

  it('edit mode: read-only profile shows a read-only banner and disables the name field', async () => {
    const view = render(
      <ProfileEditor
        backendId="b1"
        profile={{ ...makeProfile('p1', 'Coding'), status: 'readonly' }}
        onBack={vi.fn()}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
      />
    );
    const name = await screen.findByPlaceholderText(NAME_PLACEHOLDER);
    expect(name).toBeDisabled();
    expect(
      screen.getByText(/has been converted to read-only/i)
    ).toBeInTheDocument();
    view.unmount();
  });

  it('create mode shows no delete entry point', async () => {
    await renderEditor(null);
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('shows Model tab by default and switches to the Prompt tab', async () => {
    await renderEditor(makeProfile('p1', 'Coding'));

    // Model tab content is visible by default (Agent Type select lives in Model).
    expect(screen.getByLabelText('Agent Type')).toBeInTheDocument();
    // System Prompt lives in the Prompt tab — not mounted yet.
    expect(screen.queryByPlaceholderText('You are a helpful coding agent...')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /Prompt/ }));

    // Now the prompt editor is reachable and the Agent Type select is gone.
    // (System Prompt starts collapsed; expand it, then the textarea appears.)
    fireEvent.click(screen.getByText('No system prompt set — click to edit.'));
    expect(screen.getByPlaceholderText('You are a helpful coding agent...')).toBeInTheDocument();
    expect(screen.queryByLabelText('Agent Type')).toBeNull();
  });

  it('repopulates the form when the profile prop switches', async () => {
    const { rerender, onSaved, onDeleted } = await renderEditor(makeProfile('p1', 'Coder'));
    await screen.findByDisplayValue('Coder');

    rerender(
      <ProfileEditor
        backendId="b1"
        profile={makeProfile('p2', 'Reviewer')}
        onBack={vi.fn()}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    );

    await screen.findByDisplayValue('Reviewer');
    expect(screen.queryByDisplayValue('Coder')).toBeNull();
  });

  it('Claude runtime merges model settings into Runtime as read-only Auto fields', async () => {
    // model: '' so the zclaudia model dropdown trigger renders its placeholder
    // ("Select a model") rather than the already-matched "Sonnet" label.
    await renderEditor({ ...makeProfile('p1', 'Coding'), model: '' }); // zclaudia by default

    // zclaudia shows the LLM-profile-bound model dropdown trigger:
    expect(screen.getByText('Select a model')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Agent Type'));
    fireEvent.click(screen.getByRole('button', { name: 'Claude' }));

    // Claude keeps native model settings in Runtime and removes the separate Model card.
    expect(screen.queryByText('Select a model')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Model' })).toBeNull();
    // Claude auto-defaults render as plain read-only values, not editable fields.
    expect(screen.getByLabelText('Model').tagName).toBe('SPAN');
    expect(screen.getByLabelText('Model')).toHaveTextContent('Auto (CLI default)');
    expect(screen.getByLabelText('Thinking Level').tagName).toBe('SPAN');
    expect(screen.getByLabelText('Thinking Level')).toHaveTextContent('Auto');
    expect(screen.queryByText('Multimodal fallback')).toBeNull();
    expect(screen.getByText(/Claude Agent SDK runtime/)).toBeInTheDocument();
  });

  it('switching runtime shows read-only Claude auto defaults', async () => {
    await renderEditor(makeProfile('p1', 'Coding'));
    fireEvent.click(screen.getByLabelText('Agent Type'));
    fireEvent.click(screen.getByRole('button', { name: 'Claude' }));
    expect(screen.getByLabelText('Model')).toHaveTextContent('Auto (CLI default)');
    expect(screen.getByLabelText('Thinking Level')).toHaveTextContent('Auto');
  });

  it('create: a Claude profile is valid without an LLM profile and saves llmProfileId ""', async () => {
    vi.mocked(api.createAgentProfileForBackend).mockResolvedValue(
      makeProfile('n1', 'Claude Agent')
    );
    const { onSaved } = await renderEditor(null); // create mode

    fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
      target: { value: 'Claude Agent' },
    });
    fireEvent.click(screen.getByLabelText('Agent Type'));
    fireEvent.click(screen.getByRole('button', { name: 'Claude' }));

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(api.createAgentProfileForBackend).toHaveBeenCalledWith(
        'b1',
        expect.objectContaining({
          runtimeType: 'claude',
          llmProfileId: '',
          model: '',
          thinkingLevel: undefined,
        })
      );
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
  });

  it('create: a Claude profile can use CLI path and auto model', async () => {
    vi.mocked(api.createAgentProfileForBackend).mockResolvedValue({
      ...makeProfile('n1', 'Claude Auto'),
      runtimeType: 'claude',
      model: '',
      cliPath: '/opt/homebrew/bin/claude',
    });
    await renderEditor(null);

    fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
      target: { value: 'Claude Auto' },
    });
    fireEvent.click(screen.getByLabelText('Agent Type'));
    fireEvent.click(screen.getByRole('button', { name: 'Claude' }));
    fireEvent.change(screen.getByLabelText('CLI Path (optional)'), {
      target: { value: '/opt/homebrew/bin/claude' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(api.createAgentProfileForBackend).toHaveBeenCalledWith(
        'b1',
        expect.objectContaining({
          runtimeType: 'claude',
          llmProfileId: '',
          model: '',
          cliPath: '/opt/homebrew/bin/claude',
        })
      );
    });
  });

  it('default-agent Toggle flips isDefault', async () => {
    await renderEditor(null);
    const toggle = screen.getByRole('switch', { name: 'Set as default agent' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('renders an unavailable note for a runtime with no descriptor (plugin not active)', async () => {
    const ghost = { ...makeProfile('g1', 'Ghost'), runtimeType: 'ghost' };
    await renderEditor(ghost);
    // Does not crash; surfaces the unavailable note instead of a normal runtime form.
    expect(
      await screen.findByText(
        'Runtime "ghost" is not available on this backend. Enable the plugin that provides it.'
      )
    ).toBeInTheDocument();
  });

  it('a generic native runtime renders a free-text model input, interactive thinking selector, and no CLI Path field', async () => {
    useRuntimeDescriptorStore.getState().setDescriptors(
      [...RUNTIME_DESCRIPTORS, GENERIC_NATIVE_DESCRIPTOR],
      'b1'
    );
    await renderEditor(null);

    fireEvent.click(screen.getByLabelText('Agent Type'));
    fireEvent.click(screen.getByRole('button', { name: 'Generic Native' }));

    // Free-text model input, not the LLM-profile-bound dropdown or a static "none" row.
    const modelInput = screen.getByLabelText('Model') as HTMLInputElement;
    expect(modelInput.tagName).toBe('INPUT');
    fireEvent.change(modelInput, { target: { value: 'some-model-id' } });
    expect(modelInput).toHaveValue('some-model-id');

    // Interactive thinking selector (not a static "Auto" row).
    expect(screen.getByLabelText('Thinking Level').tagName).not.toBe('SPAN');

    // No CLI Path field for a runtime with hasCliPath: false.
    expect(screen.queryByLabelText('CLI Path (optional)')).toBeNull();
  });
});
