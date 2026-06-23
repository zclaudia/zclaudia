// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const toolsMock = vi.fn();
const gitStateMock = vi.fn();
const sessionIdMock = vi.fn();
const changesMock = vi.fn();

vi.mock('../../stores/sessionToolsStore', () => ({
  useSessionToolsStore: (selector: any) => selector({ tools: toolsMock() }),
}));
vi.mock('../../features/git/store', () => ({
  useGitStore: (selector: any) => selector(gitStateMock()),
}));
vi.mock('../../stores/selectionStore', () => ({
  useSelectionStore: (selector: any) => selector({ selectedSessionId: sessionIdMock() }),
}));
vi.mock('../changes/useSessionChanges', () => ({
  useChangesData: () => ({ result: { modified: changesMock(), affected: [], turns: [] } }),
}));

import { RightSidebarEmptyState } from '../RightSidebarEmptyState';

const onTerminal = vi.fn();
const onChanges = vi.fn();

function tool(iconKey: string, over: Partial<any> = {}) {
  return {
    id: iconKey === 'changes' ? 'session-changes' : iconKey,
    label: iconKey,
    iconKey,
    isActive: false,
    onClick: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  cleanup();
  onTerminal.mockClear();
  onChanges.mockClear();
  toolsMock.mockReturnValue([
    tool('terminal', { label: 'Terminal', onClick: onTerminal }),
    tool('changes', { label: 'Changes', onClick: onChanges }),
    tool('file', { label: 'File' }),
  ]);
  gitStateMock.mockReturnValue({ worktrees: {}, selectedWorktree: {} });
  sessionIdMock.mockReturnValue('s1');
  changesMock.mockReturnValue([]);
});

function renderEmpty() {
  return render(<RightSidebarEmptyState projectId="p1" projectRoot="/repo" />);
}

describe('RightSidebarEmptyState', () => {
  it('renders one tile per pinned tool with its label', () => {
    renderEmpty();
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('Changes')).toBeInTheDocument();
    expect(screen.getByText('File')).toBeInTheDocument();
  });

  it('invokes a tool onClick when its tile is clicked', () => {
    renderEmpty();
    fireEvent.click(screen.getByText('Terminal'));
    expect(onTerminal).toHaveBeenCalledTimes(1);
  });

  it('shows the branch when git data is present', () => {
    gitStateMock.mockReturnValue({
      worktrees: { p1: [{ path: '/wt', branch: 'main' }] },
      selectedWorktree: { p1: '/wt' },
    });
    renderEmpty();
    expect(screen.getByText('main')).toBeInTheDocument();
  });

  it('omits the branch when no git data', () => {
    renderEmpty();
    expect(screen.queryByText('main')).toBeNull();
  });

  it('shows the changes count when there are changes', () => {
    changesMock.mockReturnValue([{}, {}, {}]);
    renderEmpty();
    expect(screen.getByText('3 个文件待查看')).toBeInTheDocument();
  });

  it('hides the changes count and uses the static subtitle at zero', () => {
    renderEmpty();
    expect(screen.queryByText(/个文件待查看/)).toBeNull();
    expect(screen.getByText('查看本次会话改动')).toBeInTheDocument();
  });

  it('moves the changes tile to the front when there are changes', () => {
    changesMock.mockReturnValue([{}, {}]);
    renderEmpty();
    const labels = screen.getAllByTestId('empty-tile-label').map((n) => n.textContent);
    expect(labels[0]).toBe('Changes');
  });

  it('keeps declared order when there are no changes', () => {
    renderEmpty();
    const labels = screen.getAllByTestId('empty-tile-label').map((n) => n.textContent);
    expect(labels).toEqual(['Terminal', 'Changes', 'File']);
  });
});
