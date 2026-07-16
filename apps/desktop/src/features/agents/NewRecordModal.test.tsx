// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NewRecordModal } from './NewRecordModal';

function setup(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(
    <NewRecordModal
      open
      title="New skill"
      label="Skill ID"
      placeholder="e.g. my-skill"
      onSubmit={onSubmit}
      onClose={onClose}
    />
  );
  return { onSubmit, onClose };
}

describe('NewRecordModal', () => {
  it('disables Create until a value is entered, then submits the trimmed value', async () => {
    const { onSubmit } = setup();
    const create = screen.getByRole('button', { name: 'Create' });
    expect(create).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Skill ID'), { target: { value: '  my-skill  ' } });
    expect(create).not.toBeDisabled();
    fireEvent.click(create);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('my-skill'));
  });

  it('submits on Enter', async () => {
    const { onSubmit } = setup();
    const input = screen.getByLabelText('Skill ID');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('x'));
  });

  it('shows an inline error and re-enables Create when onSubmit throws', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'));
    setup(onSubmit);
    fireEvent.change(screen.getByLabelText('Skill ID'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).not.toBeDisabled();
  });

  it('Cancel calls onClose without submitting', () => {
    const { onSubmit, onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
