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

  it('hides context badges and a settled save state below md', () => {
    const { container } = render(
      <ProfileHeader
        {...base}
        badges={[
          { label: 'Dev MacBook', secondary: true },
          { label: 'Read-only', tone: 'neutral' },
        ]}
        saveStatus="saved"
      />
    );
    // Which backend a record lives on is context; read-only changes what you can
    // do with it. Only the latter earns a slot on a phone.
    expect(screen.getByText('Dev MacBook').closest('span.hidden')).not.toBeNull();
    expect(screen.getByText('Read-only').closest('span.hidden')).toBeNull();
    expect(screen.getByTestId('save-state').closest('span.hidden')).not.toBeNull();
    // Read-only is a signal, so the cluster still takes its mobile line here.
    expect(container.querySelector('.basis-full')!.className).not.toContain('hidden');
  });

  it('drops the cluster entirely below md when nothing needs attention', () => {
    const { container } = render(
      <ProfileHeader
        {...base}
        badges={[
          { label: 'Dev MacBook', secondary: true },
          { label: 'Default', tone: 'accent', secondary: true },
        ]}
        saveStatus="saved"
      />
    );
    // Context only — a phone gets a one-line header.
    expect(container.querySelector('.basis-full')!.className).toContain('hidden');
  });

  it('keeps an unsettled save state visible below md', () => {
    render(<ProfileHeader {...base} saveStatus="failed" />);
    expect(screen.getByTestId('save-state').closest('span.hidden')).toBeNull();
  });

  it('drops the crumb label below md but keeps the back button labelled', () => {
    render(<ProfileHeader {...base} />);
    const back = screen.getByRole('button', { name: 'Back to Agent Profiles' });
    // The visible text is hidden below md; the accessible name is not.
    expect(back.querySelector('span')!.className).toContain('hidden');
  });

  it('gives the status cluster its own line below md so the name is not clipped', () => {
    const { container } = render(
      <ProfileHeader {...base} recordStatus={{ completeness: 'draft', availability: {} }} />
    );
    const cluster = container.querySelector('.basis-full')!;
    // A chip sharing the row with the name input clipped the name mid-word, and
    // an input cannot ellipsize — so below md the cluster wraps to its own line.
    expect(cluster.className).toContain('order-last');
    expect(cluster.className).toContain('md:basis-auto');
    expect(cluster.className).not.toContain('hidden');
  });

  it('keeps the badge cluster shrinkable so it can wrap at phone widths', () => {
    // jsdom has no layout, so assert the invariant instead: a `flex-wrap` cluster
    // that is also `flex-shrink-0` sizes to max-content and never wraps, which
    // pushed the save state and actions menu past the viewport edge on phones.
    render(
      <ProfileHeader
        {...base}
        badges={[{ label: 'Default', tone: 'accent' }]}
        saveStatus="saved"
        actions={[{ label: 'Delete agent', onSelect: vi.fn() }]}
      />
    );
    const cluster = screen.getByText('Default').parentElement!;
    expect(cluster.className).toContain('flex-wrap');
    expect(cluster.className).not.toContain('flex-shrink-0');
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
