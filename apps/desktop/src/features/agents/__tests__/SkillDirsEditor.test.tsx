// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { SkillDirsEditor } from '../SkillDirsEditor';
import * as api from '../../../services/api';
import type { SkillLoadDiagnostic } from '../../../services/api';

vi.mock('../../../services/api', () => ({
  saveExternalSkillDirsForBackend: vi.fn(),
}));

const diagnostics: SkillLoadDiagnostic[] = [
  {
    type: 'warning',
    code: 'MISSING_NAME',
    message: 'Skill has no name',
    path: '/dir-a/skill/SKILL.md',
    source: 'external',
  },
];

function renderEditor(dirs: string[] = ['/dir-a', '/dir-b']) {
  const onSaved = vi.fn();
  const view = render(
    <SkillDirsEditor backendId="b1" dirs={dirs} diagnostics={diagnostics} onSaved={onSaved} />
  );
  return { onSaved, ...view };
}

describe('SkillDirsEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.saveExternalSkillDirsForBackend).mockResolvedValue(undefined);
  });

  it('renders the dirs and diagnostics', () => {
    renderEditor();

    expect(screen.getByText('/dir-a')).toBeInTheDocument();
    expect(screen.getByText('/dir-b')).toBeInTheDocument();
    expect(screen.getByText('Skill diagnostics')).toBeInTheDocument();
    expect(screen.getByText('MISSING_NAME')).toBeInTheDocument();
    expect(screen.getByText('Skill has no name')).toBeInTheDocument();
  });

  it('add: saves the whole array including the new path and fires onSaved', async () => {
    const { onSaved } = renderEditor();

    fireEvent.change(screen.getByPlaceholderText('/path/to/skills/directory'), {
      target: { value: '/dir-c' },
    });
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));

    await waitFor(() => {
      expect(api.saveExternalSkillDirsForBackend).toHaveBeenCalledWith('b1', [
        '/dir-a',
        '/dir-b',
        '/dir-c',
      ]);
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    expect(screen.getByText('/dir-c')).toBeInTheDocument();
  });

  it('remove: saves the array without the removed path and fires onSaved', async () => {
    const { onSaved } = renderEditor();

    const removeButtons = screen.getAllByTitle('Remove');
    fireEvent.click(removeButtons[0]);

    await waitFor(() => {
      expect(api.saveExternalSkillDirsForBackend).toHaveBeenCalledWith('b1', ['/dir-b']);
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    expect(screen.queryByText('/dir-a')).toBeNull();
  });

  it('does not save a duplicate directory', async () => {
    const { onSaved } = renderEditor();

    fireEvent.change(screen.getByPlaceholderText('/path/to/skills/directory'), {
      target: { value: '/dir-a' },
    });
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));

    await waitFor(() => {
      expect(api.saveExternalSkillDirsForBackend).not.toHaveBeenCalled();
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('shows an inline error when save fails', async () => {
    vi.mocked(api.saveExternalSkillDirsForBackend).mockRejectedValue(new Error('dirs boom'));

    const { onSaved } = renderEditor();

    fireEvent.change(screen.getByPlaceholderText('/path/to/skills/directory'), {
      target: { value: '/dir-c' },
    });
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));

    expect(await screen.findByText('dirs boom')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
