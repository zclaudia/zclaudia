// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { AgentProfileConfig, LlmProfileConfig } from '@zclaudia/shared';

import { ProfileEditor } from '../ProfileEditor';
import * as api from '../../../services/api';

vi.mock('../../../services/api', () => ({
  listLlmProfilesForBackend: vi.fn(),
  getWorkspaceSkillsForBackend: vi.fn(),
  getMcpServersForBackend: vi.fn(),
  getMcpServerStatusesForBackend: vi.fn(),
  createAgentProfileForBackend: vi.fn(),
  updateAgentProfileForBackend: vi.fn(),
  deleteAgentProfileForBackend: vi.fn(),
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

    expect(screen.getByLabelText('Agent Type')).toHaveValue('zclaudia');
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
    fireEvent.change(screen.getByLabelText('Agent Type'), {
      target: { value: 'claude' },
    });
    fireEvent.change(screen.getByLabelText('Claude Model'), {
      target: { value: 'claude-opus-4-8' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(api.createAgentProfileForBackend).toHaveBeenCalledWith(
        'b1',
        expect.objectContaining({
          name: 'Claude Agent',
          runtimeType: 'claude',
        })
      );
    });
  });

  it('shows Claude runtime limitations when Claude is selected', async () => {
    await renderEditor(null);

    expect(screen.queryByText(/Claude Agent SDK/)).toBeNull();
    expect(screen.getByText('Multimodal fallback')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Agent Type'), {
      target: { value: 'claude' },
    });

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
          capabilities: { vision: true },
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
    fireEvent.change(screen.getByLabelText('Fallback LLM Profile'), {
      target: { value: 'vision-lp' },
    });
    fireEvent.change(screen.getByLabelText('Fallback Model'), {
      target: { value: 'vision-model' },
    });
    fireEvent.change(screen.getByLabelText('Agent Type'), {
      target: { value: 'claude' },
    });
    fireEvent.change(screen.getByLabelText('Claude Model'), {
      target: { value: 'claude-opus-4-8' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(api.createAgentProfileForBackend).toHaveBeenCalledWith(
        'b1',
        expect.objectContaining({
          runtimeType: 'claude',
          multimodalFallback: undefined,
        })
      );
    });
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

    fireEvent.change(screen.getByLabelText('Agent Type'), { target: { value: 'claude' } });
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
    vi.mocked(api.deleteAgentProfileForBackend).mockResolvedValue(undefined);

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

  it('Claude runtime reshapes the Model tab: native model input, no LLM model dropdown, no fallback, authNote', async () => {
    // model: '' so the zclaudia model dropdown trigger renders its placeholder
    // ("Select a model") rather than the already-matched "Sonnet" label.
    await renderEditor({ ...makeProfile('p1', 'Coding'), model: '' }); // zclaudia by default

    // zclaudia shows the LLM-profile-bound model dropdown trigger:
    expect(screen.getByText('Select a model')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Agent Type'), { target: { value: 'claude' } });

    // native: free-text Claude model input replaces the dropdown; fallback section gone; authNote shown.
    expect(screen.queryByText('Select a model')).toBeNull();
    expect(screen.getByLabelText('Claude Model')).toBeInTheDocument();
    expect(screen.queryByText('Multimodal fallback')).toBeNull();
    expect(screen.getByText(/Claude Agent SDK runtime/)).toBeInTheDocument();
  });

  it('switching runtime clears the model (pending re-selection)', async () => {
    await renderEditor(makeProfile('p1', 'Coding'));
    fireEvent.change(screen.getByLabelText('Agent Type'), { target: { value: 'claude' } });
    expect(screen.getByLabelText('Claude Model')).toHaveValue('');
  });

  it('create: a Claude profile is valid without an LLM profile and saves llmProfileId ""', async () => {
    vi.mocked(api.createAgentProfileForBackend).mockResolvedValue(
      makeProfile('n1', 'Claude Agent')
    );
    const { onSaved } = await renderEditor(null); // create mode

    fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
      target: { value: 'Claude Agent' },
    });
    fireEvent.change(screen.getByLabelText('Agent Type'), { target: { value: 'claude' } });
    fireEvent.change(screen.getByLabelText('Claude Model'), {
      target: { value: 'claude-opus-4-8' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(api.createAgentProfileForBackend).toHaveBeenCalledWith(
        'b1',
        expect.objectContaining({
          runtimeType: 'claude',
          llmProfileId: '',
          model: 'claude-opus-4-8',
        })
      );
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
  });
});
