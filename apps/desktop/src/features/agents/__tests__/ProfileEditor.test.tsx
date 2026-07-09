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
    <ProfileEditor backendId="b1" profile={profile} onSaved={onSaved} onDeleted={onDeleted} />
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
    fireEvent.click(screen.getByText('Select a model'));
    fireEvent.click(screen.getByText('Sonnet'));

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
        /AI review, multimodal attachments and fallback, and background task controls are zclaudia-only/
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
    fireEvent.click(screen.getByText('Select a model'));
    fireEvent.click(screen.getByText('Sonnet'));

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
        <ProfileEditor backendId="b1" profile={existing} onSaved={onSaved} onDeleted={vi.fn()} />
      );
      // catalog load resolves on fake timers
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      // No Update button in edit mode.
      expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();

      fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), { target: { value: 'Coding 2' } });

      // Debounce window elapses → one autosave.
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });

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

  it('keeps capability details collapsed until a summary row is expanded', async () => {
    const { queryAllByLabelText } = await renderEditor(null);

    expect(queryAllByLabelText(/enable full tool set/)).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /Tool Sets/ }));

    expect(queryAllByLabelText(/enable full tool set/).length).toBeGreaterThan(0);
  });

  it('delete: first click arms confirmation, second click deletes and fires onDeleted', async () => {
    vi.mocked(api.deleteAgentProfileForBackend).mockResolvedValue(undefined);

    const { onDeleted } = await renderEditor(makeProfile('p1', 'Coder'));

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.deleteAgentProfileForBackend).not.toHaveBeenCalled();

    const confirmButton = await screen.findByRole('button', { name: 'Confirm delete' });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(api.deleteAgentProfileForBackend).toHaveBeenCalledWith('b1', 'p1');
    });
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalled();
    });
  });

  it('create mode shows no delete button', async () => {
    await renderEditor(null);
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('clears an armed delete confirmation when the profile prop switches', async () => {
    const { rerender, onSaved, onDeleted } = await renderEditor(makeProfile('p1', 'Coder'));

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByRole('button', { name: 'Confirm delete' });

    rerender(
      <ProfileEditor
        backendId="b1"
        profile={makeProfile('p2', 'Reviewer')}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    );

    expect(await screen.findByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm delete' })).toBeNull();
    expect(api.deleteAgentProfileForBackend).not.toHaveBeenCalled();
  });

  it('repopulates the form when the profile prop switches', async () => {
    const { rerender, onSaved, onDeleted } = await renderEditor(makeProfile('p1', 'Coder'));
    await screen.findByDisplayValue('Coder');

    rerender(
      <ProfileEditor
        backendId="b1"
        profile={makeProfile('p2', 'Reviewer')}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    );

    await screen.findByDisplayValue('Reviewer');
    expect(screen.queryByDisplayValue('Coder')).toBeNull();
  });
});
