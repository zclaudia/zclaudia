// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProfileHeader } from './ProfileHeader';

const base = {
  crumb: 'Agent Profiles',
  onBack: vi.fn(),
  name: 'Coding',
  onNameChange: vi.fn(),
  namePlaceholder: 'e.g., Default Coding Agent',
  description: 'For coding tasks',
  onDescriptionChange: vi.fn(),
};

describe('ProfileHeader', () => {
  it('renders the crumb back button and calls onBack', () => {
    const onBack = vi.fn();
    render(<ProfileHeader {...base} onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: /Agent Profiles/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders name/description as editable inputs and reports changes', () => {
    const onNameChange = vi.fn();
    const onDescriptionChange = vi.fn();
    render(
      <ProfileHeader
        {...base}
        onNameChange={onNameChange}
        onDescriptionChange={onDescriptionChange}
      />
    );
    const name = screen.getByPlaceholderText('e.g., Default Coding Agent') as HTMLInputElement;
    expect(name.value).toBe('Coding');
    fireEvent.change(name, { target: { value: 'Coding 2' } });
    expect(onNameChange).toHaveBeenCalledWith('Coding 2');
    fireEvent.change(screen.getByPlaceholderText('Add a description'), { target: { value: 'x' } });
    expect(onDescriptionChange).toHaveBeenCalledWith('x');
  });

  it('omits the description input when onDescriptionChange is absent', () => {
    const { onDescriptionChange: _omit, description: _omitDesc, ...noDescription } = base;
    void _omit;
    void _omitDesc;
    render(<ProfileHeader {...noDescription} />);
    expect(screen.getByPlaceholderText('e.g., Default Coding Agent')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Add a description')).toBeNull();
  });

  it('flushes on blur of the name field', () => {
    const onFieldBlur = vi.fn();
    render(<ProfileHeader {...base} onFieldBlur={onFieldBlur} />);
    fireEvent.blur(screen.getByPlaceholderText('e.g., Default Coding Agent'));
    expect(onFieldBlur).toHaveBeenCalledTimes(1);
  });

  it('edit mode: shows the save indicator without profile actions', () => {
    render(<ProfileHeader {...base} saveStatus="saved" />);
    expect(screen.getByTestId('save-state')).toHaveTextContent('Saved');
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('create mode: no save indicator when handlers are absent', () => {
    render(<ProfileHeader {...base} />);
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(screen.queryByTestId('save-state')).toBeNull();
  });

  it('renders badges', () => {
    render(<ProfileHeader {...base} badges={[{ label: 'Default', tone: 'accent' }]} />);
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('renders the actions menu and fires the selected action', () => {
    const onDelete = vi.fn();
    render(
      <ProfileHeader
        {...base}
        actions={[
          { label: 'Set as default agent', onSelect: vi.fn(), disabled: true },
          { label: 'Delete agent', onSelect: onDelete, destructive: true },
        ]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitem', { name: 'Set as default agent' })).toBeDisabled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete agent' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('renders a StatusChip when recordStatus is provided', () => {
    render(
      <ProfileHeader
        {...base}
        recordStatus={{ completeness: 'draft', availability: { usable: true } }}
      />
    );
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('renders no chip when recordStatus is omitted', () => {
    render(<ProfileHeader {...base} />);
    expect(screen.queryByText('Draft')).toBeNull();
  });
});
