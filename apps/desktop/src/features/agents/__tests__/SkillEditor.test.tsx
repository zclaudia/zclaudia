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

const mockConfirm = vi.hoisted(() => vi.fn());
vi.mock('../../../stores/confirmDialogStore', () => ({ confirm: mockConfirm }));

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

function renderEditor(skill: WorkspaceSkillInfo | null) {
  const onSaved = vi.fn();
  const onDeleted = vi.fn();
  const onBack = vi.fn();
  const view = render(
    <SkillEditor
      backendId="b1"
      skill={skill}
      backendName="Backend 1"
      onBack={onBack}
      onSaved={onSaved}
      onDeleted={onDeleted}
    />
  );
  return { onSaved, onDeleted, onBack, ...view };
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

  it('edit mode: loads content for the backend + skill and autosaves edits on blur', async () => {
    const { onSaved } = renderEditor(makeSkill());

    const textarea = await screen.findByDisplayValue('# My Skill Instructions');
    expect(api.getWorkspaceSkillForBackend).toHaveBeenCalledWith('b1', 'my-skill');

    fireEvent.change(textarea, { target: { value: '# Updated' } });
    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(api.saveWorkspaceSkillForBackend).toHaveBeenCalledWith('b1', 'my-skill', '# Updated');
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith('my-skill');
    });
  });

  it('create mode: holds save until an id and content are present, then autosaves with the typed id', async () => {
    const { onSaved } = renderEditor(null);

    const idInput = screen.getByPlaceholderText('e.g. my-skill');
    const contentInput = screen.getByLabelText('SKILL.md content');

    fireEvent.change(idInput, { target: { value: 'new-skill' } });
    // Id present but no content yet → not valid, nothing persisted.
    expect(screen.getByTestId('save-state')).toHaveTextContent('Not saved');
    expect(api.saveWorkspaceSkillForBackend).not.toHaveBeenCalled();

    fireEvent.change(contentInput, { target: { value: '# New Skill' } });
    fireEvent.blur(contentInput);

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

  it('delete: confirms via dialog from the header menu, then deletes and fires onDeleted', async () => {
    mockConfirm.mockResolvedValue(true);
    const { onDeleted } = renderEditor(makeSkill());
    await screen.findByDisplayValue('# My Skill Instructions');

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete skill' }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Delete skill?', destructive: true })
      );
    });
    await waitFor(() => {
      expect(api.deleteWorkspaceSkillForBackend).toHaveBeenCalledWith('b1', 'my-skill');
    });
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalled();
    });
  });

  it('delete: cancelling the confirm dialog deletes nothing', async () => {
    mockConfirm.mockResolvedValue(false);
    const { onDeleted } = renderEditor(makeSkill());
    await screen.findByDisplayValue('# My Skill Instructions');

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete skill' }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalled();
    });
    expect(api.deleteWorkspaceSkillForBackend).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('non-workspace skill: read-only info with no content fetch, no autosave, no delete', async () => {
    renderEditor(makeSkill({ id: 'ext-skill', name: 'External Skill', source: 'external' }));

    expect(screen.getByText('External Skill')).toBeInTheDocument();
    expect(screen.getByText('Managed by its source — read-only.')).toBeInTheDocument();
    // The server's GET /skills/:skillId only reads workspace skills, so no fetch.
    expect(api.getWorkspaceSkillForBackend).not.toHaveBeenCalled();
    // Read-only records don't surface the autosave indicator or a delete action.
    expect(screen.queryByTestId('save-state')).toBeNull();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('plugin skill: also read-only', async () => {
    renderEditor(makeSkill({ id: 'plug-skill', name: 'Plugin Skill', source: 'plugin' }));

    expect(screen.getByText('Managed by its source — read-only.')).toBeInTheDocument();
    expect(api.getWorkspaceSkillForBackend).not.toHaveBeenCalled();
    expect(screen.queryByTestId('save-state')).toBeNull();
  });

  it('shows an inline error when the content load fails', async () => {
    vi.mocked(api.getWorkspaceSkillForBackend).mockRejectedValue(new Error('load boom'));

    renderEditor(makeSkill());

    expect(await screen.findByText('load boom')).toBeInTheDocument();
  });

  it('eligible badge uses the success tone', async () => {
    renderEditor(makeSkill({ eligible: true }));

    const badge = screen.getByText('Eligible');
    expect(badge.className).toContain('bg-success/15');
    expect(badge.className).toContain('text-success');
  });

  it('blocked badge uses destructive tokens, not success', async () => {
    renderEditor(makeSkill({ eligible: false }));

    const badge = screen.getByText('Blocked');
    expect(badge.className).toContain('bg-destructive/15');
    expect(badge.className).toContain('text-destructive');
    expect(badge.className).not.toContain('success');
  });

  it('surfaces a failed save via the save-state indicator and an inline error', async () => {
    vi.mocked(api.saveWorkspaceSkillForBackend).mockRejectedValue(new Error('save boom'));

    const { onSaved } = renderEditor(makeSkill());
    const textarea = await screen.findByDisplayValue('# My Skill Instructions');

    fireEvent.change(textarea, { target: { value: '# Updated' } });
    fireEvent.blur(textarea);

    expect(await screen.findByText('save boom')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('save-state')).toHaveTextContent('Save failed');
    });
    expect(onSaved).not.toHaveBeenCalled();
  });
});
