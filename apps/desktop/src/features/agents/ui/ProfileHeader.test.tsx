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
    render(<ProfileHeader {...base} onNameChange={onNameChange} onDescriptionChange={onDescriptionChange} />);
    const name = screen.getByPlaceholderText('e.g., Default Coding Agent') as HTMLInputElement;
    expect(name.value).toBe('Coding');
    fireEvent.change(name, { target: { value: 'Coding 2' } });
    expect(onNameChange).toHaveBeenCalledWith('Coding 2');
    fireEvent.change(screen.getByPlaceholderText('Add a description'), { target: { value: 'x' } });
    expect(onDescriptionChange).toHaveBeenCalledWith('x');
  });

  it('flushes on blur of the name field', () => {
    const onFieldBlur = vi.fn();
    render(<ProfileHeader {...base} onFieldBlur={onFieldBlur} />);
    fireEvent.blur(screen.getByPlaceholderText('e.g., Default Coding Agent'));
    expect(onFieldBlur).toHaveBeenCalledTimes(1);
  });

  it('edit mode: shows the save indicator and a ⋯ menu with Delete', () => {
    const onRequestDelete = vi.fn();
    render(<ProfileHeader {...base} saveStatus="saved" onRequestDelete={onRequestDelete} />);
    expect(screen.getByTestId('save-state')).toHaveTextContent('Saved');
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete profile' }));
    expect(onRequestDelete).toHaveBeenCalledTimes(1);
  });

  it('create mode: no ⋯ menu and no save indicator when handlers are absent', () => {
    render(<ProfileHeader {...base} />);
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(screen.queryByTestId('save-state')).toBeNull();
  });

  it('renders badges', () => {
    render(<ProfileHeader {...base} badges={[{ label: 'Default', tone: 'accent' }]} />);
    expect(screen.getByText('Default')).toBeInTheDocument();
  });
});
