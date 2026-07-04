import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionItem } from '../SessionItem';

const mockSession = {
  id: 's1',
  name: 'Test Session',
  projectId: 'p1',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  type: 'interactive' as const,
  lastRunStatus: undefined,
  planStatus: undefined,
} as any;

describe('SessionItem', () => {
  it('renders session name', () => {
    render(
      <SessionItem session={mockSession} isSelected={false} onSelect={vi.fn()} hasPending={false} />
    );
    expect(screen.getByText('Test Session')).toBeDefined();
  });

  it('falls back to the auto-title, then Untitled, when unnamed', () => {
    const autoTitled = { ...mockSession, name: undefined, autoTitle: 'Refactor the parser' };
    const { rerender } = render(
      <SessionItem session={autoTitled} isSelected={false} onSelect={vi.fn()} hasPending={false} />
    );
    expect(screen.getByText('Refactor the parser')).toBeDefined();

    rerender(
      <SessionItem
        session={{ ...mockSession, name: undefined, autoTitle: undefined }}
        isSelected={false}
        onSelect={vi.fn()}
        hasPending={false}
      />
    );
    expect(screen.getByText('Untitled Session')).toBeDefined();
  });

  it('prefers an explicit name over the auto-title', () => {
    const both = { ...mockSession, name: 'My name', autoTitle: 'Auto title' };
    render(<SessionItem session={both} isSelected={false} onSelect={vi.fn()} hasPending={false} />);
    expect(screen.getByText('My name')).toBeDefined();
    expect(screen.queryByText('Auto title')).toBeNull();
  });

  it('calls onSelect when clicked', () => {
    const onSelect = vi.fn();
    render(
      <SessionItem
        session={mockSession}
        isSelected={false}
        onSelect={onSelect}
        hasPending={false}
      />
    );
    fireEvent.click(screen.getByText('Test Session'));
    expect(onSelect).toHaveBeenCalledWith('s1');
  });

  it('shows pending indicator', () => {
    render(
      <SessionItem session={mockSession} isSelected={false} onSelect={vi.fn()} hasPending={true} />
    );
    expect(screen.getByText('waiting')).toBeDefined();
  });

  it('applies selected styles', () => {
    render(
      <SessionItem session={mockSession} isSelected={true} onSelect={vi.fn()} hasPending={false} />
    );
    const button = screen.getByRole('button', { name: /Test Session/ });
    expect(button.className).toContain('-ml-5');
    expect(button.className).toContain('w-[calc(100%+1.25rem)]');
    expect(button.className).toContain('pl-7');
    expect(button.className).toContain('bg-accent');
  });

  it('shows active running state', () => {
    render(
      <SessionItem
        session={mockSession}
        isSelected={false}
        onSelect={vi.fn()}
        hasPending={false}
        isActive={true}
      />
    );
    expect(screen.getByText('running')).toBeDefined();
  });

  it('does not show running from executing plan status without active run', () => {
    render(
      <SessionItem
        session={{ ...mockSession, planStatus: 'executing' }}
        isSelected={false}
        onSelect={vi.fn()}
        hasPending={false}
        isActive={false}
      />
    );
    expect(screen.queryByText('running')).toBeNull();
  });

  it('renders the worktree branch tag when provided', () => {
    render(
      <SessionItem
        session={mockSession}
        isSelected={false}
        onSelect={vi.fn()}
        hasPending={false}
        worktreeBranch="feat/my-test"
      />
    );
    expect(screen.getByText('feat/my-test')).toBeDefined();
  });

  it('hides the worktree branch tag when hideWorktreeBranch is set', () => {
    render(
      <SessionItem
        session={mockSession}
        isSelected={false}
        onSelect={vi.fn()}
        hasPending={false}
        worktreeBranch="feat/my-test"
        hideWorktreeBranch
      />
    );
    expect(screen.queryByText('feat/my-test')).toBeNull();
  });

  it('fires onDeleteWorktree from the row menu without selecting', () => {
    const onDeleteWorktree = vi.fn();
    const onSelect = vi.fn();
    render(
      <SessionItem
        session={mockSession}
        isSelected={false}
        onSelect={onSelect}
        hasPending={false}
        onDeleteWorktree={onDeleteWorktree}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove worktree' }));
    expect(onDeleteWorktree).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('fires onPopOut from the row menu without selecting', () => {
    const onPopOut = vi.fn();
    const onSelect = vi.fn();
    render(
      <SessionItem
        session={mockSession}
        isSelected={false}
        onSelect={onSelect}
        hasPending={false}
        onPopOut={onPopOut}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in new window' }));
    expect(onPopOut).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
