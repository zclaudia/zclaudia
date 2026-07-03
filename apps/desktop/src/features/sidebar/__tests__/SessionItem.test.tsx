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
    const { container } = render(
      <SessionItem session={mockSession} isSelected={true} onSelect={vi.fn()} hasPending={false} />
    );
    expect(container.firstChild).toBeDefined();
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
