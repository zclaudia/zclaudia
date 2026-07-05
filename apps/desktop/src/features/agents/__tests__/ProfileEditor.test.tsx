// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

  it('edit mode: populates the form from the profile prop and updates via updateAgentProfileForBackend', async () => {
    const profile = makeProfile('p1', 'Coder');
    const saved = { ...profile, name: 'Coder 2' };
    vi.mocked(api.updateAgentProfileForBackend).mockResolvedValue(saved);

    const { onSaved } = await renderEditor(profile);

    const nameInput = await screen.findByDisplayValue('Coder');
    fireEvent.change(nameInput, { target: { value: 'Coder 2' } });

    fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => {
      expect(api.updateAgentProfileForBackend).toHaveBeenCalledWith(
        'b1',
        'p1',
        expect.objectContaining({
          name: 'Coder 2',
          llmProfileId: 'lp1',
          model: 'claude-sonnet-4-6',
        })
      );
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(saved);
    });
    expect(api.createAgentProfileForBackend).not.toHaveBeenCalled();
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
