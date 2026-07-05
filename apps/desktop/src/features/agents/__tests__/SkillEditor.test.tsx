// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { SkillEditor } from '../SkillEditor';
import * as api from '../../../services/api';
import type { WorkspaceSkillInfo } from '../../../services/api';

vi.mock('../../../services/api', () => ({
  getWorkspaceSkillForBackend: vi.fn(),
  saveWorkspaceSkillForBackend: vi.fn(),
  deleteWorkspaceSkillForBackend: vi.fn(),
}));

function makeSkill(overrides: Partial<WorkspaceSkillInfo> = {}): WorkspaceSkillInfo {
  return {
    id: 'my-skill',
    name: 'My Skill',
    description: 'Does things',
    path: '/workspace/skills/my-skill/SKILL.md',
    source: 'workspace',
    ...overrides,
  };
}

async function renderEditor(skill: WorkspaceSkillInfo | null) {
  const onSaved = vi.fn();
  const onDeleted = vi.fn();
  const view = render(
    <SkillEditor backendId="b1" skill={skill} onSaved={onSaved} onDeleted={onDeleted} />
  );
  return { onSaved, onDeleted, ...view };
}

describe('SkillEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getWorkspaceSkillForBackend).mockResolvedValue({
      id: 'my-skill',
      content: '# My Skill Instructions',
    });
    vi.mocked(api.saveWorkspaceSkillForBackend).mockResolvedValue(undefined);
    vi.mocked(api.deleteWorkspaceSkillForBackend).mockResolvedValue(undefined);
  });

  it('edit mode: loads content for the backend + skill and saves via saveWorkspaceSkillForBackend', async () => {
    const { onSaved } = await renderEditor(makeSkill());

    const textarea = await screen.findByDisplayValue('# My Skill Instructions');
    expect(api.getWorkspaceSkillForBackend).toHaveBeenCalledWith('b1', 'my-skill');

    fireEvent.change(textarea, { target: { value: '# Updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(api.saveWorkspaceSkillForBackend).toHaveBeenCalledWith('b1', 'my-skill', '# Updated');
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith('my-skill');
    });
  });

  it('create mode: requires an id and content, then saves with the typed id', async () => {
    const { onSaved } = await renderEditor(null);

    const createButton = screen.getByRole('button', { name: 'Create' });
    expect(createButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('e.g. my-skill'), {
      target: { value: 'new-skill' },
    });
    expect(createButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/name: My Skill/), {
      target: { value: '# New Skill' },
    });
    expect(createButton).not.toBeDisabled();

    fireEvent.click(createButton);

    await waitFor(() => {
      expect(api.saveWorkspaceSkillForBackend).toHaveBeenCalledWith(
        'b1',
        'new-skill',
        '# New Skill'
      );
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith('new-skill');
    });
    expect(api.getWorkspaceSkillForBackend).not.toHaveBeenCalled();
  });

  it('delete: first click arms confirmation, second click deletes and fires onDeleted', async () => {
    const { onDeleted } = await renderEditor(makeSkill());
    await screen.findByDisplayValue('# My Skill Instructions');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.deleteWorkspaceSkillForBackend).not.toHaveBeenCalled();

    const confirmButton = await screen.findByRole('button', { name: 'Confirm delete' });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(api.deleteWorkspaceSkillForBackend).toHaveBeenCalledWith('b1', 'my-skill');
    });
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalled();
    });
  });

  it('non-workspace skill: read-only info with no content fetch and no Save/Delete', async () => {
    await renderEditor(makeSkill({ id: 'ext-skill', name: 'External Skill', source: 'external' }));

    expect(screen.getByText('External Skill')).toBeInTheDocument();
    expect(screen.getByText('Managed by its source — read-only.')).toBeInTheDocument();
    // The server's GET /skills/:skillId only reads workspace skills, so no fetch.
    expect(api.getWorkspaceSkillForBackend).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('plugin skill: also read-only', async () => {
    await renderEditor(makeSkill({ id: 'plug-skill', name: 'Plugin Skill', source: 'plugin' }));

    expect(screen.getByText('Managed by its source — read-only.')).toBeInTheDocument();
    expect(api.getWorkspaceSkillForBackend).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('shows an inline error when the content load fails', async () => {
    vi.mocked(api.getWorkspaceSkillForBackend).mockRejectedValue(new Error('load boom'));

    await renderEditor(makeSkill());

    expect(await screen.findByText('load boom')).toBeInTheDocument();
  });

  it('shows an inline error when save fails', async () => {
    vi.mocked(api.saveWorkspaceSkillForBackend).mockRejectedValue(new Error('save boom'));

    const { onSaved } = await renderEditor(makeSkill());
    await screen.findByDisplayValue('# My Skill Instructions');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('save boom')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
