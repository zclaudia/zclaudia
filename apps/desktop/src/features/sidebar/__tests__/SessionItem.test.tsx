import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionItem } from '../SessionItem';
import { useAppearanceStore } from '../../../stores/appearanceStore';
import { useDragSplitStore } from '../../../components/workspace/dragSplit';
import { useRightWorkspaceStore } from '../../../stores/rightWorkspaceStore';
import { useProjectWorkspaceStore } from '../../../stores/projectWorkspaceStore';

const { selectProjectChat } = vi.hoisted(() => ({ selectProjectChat: vi.fn() }));
vi.mock('../../../actions/projectWorkspaceActions', () => ({ selectProjectChat }));

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
  beforeEach(() => {
    vi.clearAllMocks();
    useAppearanceStore.setState({ unifiedWorkspace: false });
    useDragSplitStore.getState().endDrag();
    useRightWorkspaceStore.setState({ bySession: {}, order: [] });
    useProjectWorkspaceStore.setState({ byProject: {} });
  });

  it('opens a distinct pane on modifier click only on unified desktop', () => {
    useAppearanceStore.setState({ unifiedWorkspace: true });
    const onSelect = vi.fn();
    const { rerender } = render(<SessionItem session={mockSession} isSelected={false} onSelect={onSelect} hasPending={false} />);
    fireEvent.click(screen.getByText('Test Session'), { metaKey: true });
    expect(selectProjectChat).toHaveBeenCalledWith('p1', 's1', { beside: true });
    expect(onSelect).toHaveBeenCalledWith('s1');
    selectProjectChat.mockClear();
    rerender(<SessionItem session={mockSession} isSelected={false} onSelect={onSelect} hasPending={false} isMobile />);
    fireEvent.click(screen.getByText('Test Session'), { ctrlKey: true });
    expect(selectProjectChat).not.toHaveBeenCalled();
  });

  it('starts unopened session drags and cancels them on normal click or release outside workspace', () => {
    useAppearanceStore.setState({ unifiedWorkspace: true });
    render(<SessionItem session={mockSession} isSelected={false} onSelect={vi.fn()} hasPending={false} />);
    const row = screen.getByRole('button', { name: 'Test Session' });
    const pointerDown = new Event('pointerdown', { bubbles: true });
    Object.assign(pointerDown, { button: 0, pointerType: 'mouse' });
    fireEvent(row, pointerDown);
    expect(useDragSplitStore.getState().active).toMatchObject({ toolId: 'chat', instanceKey: 's1', projectId: 'p1', multiInstance: true });
    expect(useDragSplitStore.getState().active?.sourcePaneId).toBeUndefined();
    fireEvent.click(row);
    expect(useDragSplitStore.getState().active).toBeNull();
    fireEvent(row, pointerDown);
    fireEvent.pointerUp(document.body);
    expect(useDragSplitStore.getState().active).toBeNull();
  });

  it('includes an existing chat pane source and ignores mobile drag gestures', () => {
    useAppearanceStore.setState({ unifiedWorkspace: true });
    useRightWorkspaceStore.getState().ensureChatSession('s1');
    const { rerender } = render(<SessionItem session={mockSession} isSelected={false} onSelect={vi.fn()} hasPending={false} />);
    const pointerDown = new Event('pointerdown', { bubbles: true });
    Object.assign(pointerDown, { button: 0, pointerType: 'mouse' });
    fireEvent(screen.getByRole('button', { name: 'Test Session' }), pointerDown);
    expect(useDragSplitStore.getState().active?.sourcePaneId).toBeTruthy();
    rerender(<SessionItem session={mockSession} isSelected={false} onSelect={vi.fn()} hasPending={false} isMobile />);
    expect(useDragSplitStore.getState().active).toBeNull();
    fireEvent(screen.getByRole('button', { name: 'Test Session' }), pointerDown);
    expect(useDragSplitStore.getState().active).toBeNull();
  });

  it('exposes arrange actions and restores focus after Escape', () => {
    useAppearanceStore.setState({ unifiedWorkspace: true });
    render(<SessionItem session={mockSession} isSelected={false} onSelect={vi.fn()} hasPending={false} />);
    const trigger = screen.getByRole('button', { name: 'Session actions' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Open beside' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Compare with current chat' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });
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
