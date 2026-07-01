// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { usePluginStore } from '../../stores/pluginStore';

const gitStateMock = vi.fn();
const changesMock = vi.fn();

vi.mock('../../features/git/store', () => ({
  useGitStore: (selector: any) => selector(gitStateMock()),
}));
vi.mock('../changes/useSessionChanges', () => ({
  useChangesData: () => ({ result: { modified: changesMock(), affected: [], turns: [] } }),
}));
vi.mock('../../stores/serverStore', () => ({
  useServerStore: (selector: any) => selector({ activeServerId: 'local' }),
}));
vi.mock('../../utils/workspaceActions', () => ({
  openToolInWorkspace: vi.fn(),
}));

import { RightSidebarEmptyState } from '../RightSidebarEmptyState';
import { openToolInWorkspace } from '../../utils/workspaceActions';

beforeEach(() => {
  cleanup();
  gitStateMock.mockReturnValue({ worktrees: {}, selectedWorktree: {} });
  changesMock.mockReturnValue([]);

  // Reset plugin store and register the 5 known tile panels.
  usePluginStore.setState({ panels: [], disabledBuiltinPanels: [], panelPlacements: {} });
  usePluginStore.getState().registerPanel({
    id: 'terminal',
    pluginId: 'com.zclaudia.builtin',
    type: 'panel',
    label: 'Terminal',
    order: 0,
    platforms: ['desktop'],
  });
  usePluginStore.getState().registerPanel({
    id: 'session-changes',
    pluginId: 'com.zclaudia.builtin',
    type: 'panel',
    label: 'Changes',
    order: 1,
    platforms: ['desktop'],
  });
  usePluginStore.getState().registerPanel({
    id: 'file-viewer',
    pluginId: 'com.zclaudia.builtin',
    type: 'panel',
    label: 'File',
    order: 2,
    platforms: ['desktop'],
  });
  usePluginStore.getState().registerPanel({
    id: 'draft',
    pluginId: 'com.zclaudia.builtin',
    type: 'panel',
    label: 'Draft',
    order: 3,
    platforms: ['desktop'],
  });
  usePluginStore.getState().registerPanel({
    id: 'lineage',
    pluginId: 'com.zclaudia.builtin',
    type: 'panel',
    label: 'Lineage',
    order: 4,
    platforms: ['desktop'],
  });
});

function renderEmpty() {
  return render(<RightSidebarEmptyState sessionId="s1" projectId="p1" projectRoot="/repo" />);
}

describe('RightSidebarEmptyState', () => {
  it('renders one tile per registered panel with its label', () => {
    renderEmpty();
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('Changes')).toBeInTheDocument();
    expect(screen.getByText('File')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Lineage')).toBeInTheDocument();
  });

  it('calls openToolInWorkspace when a tile is clicked', () => {
    renderEmpty();
    fireEvent.click(screen.getByText('Terminal'));
    expect(openToolInWorkspace).toHaveBeenCalledWith('s1', 'terminal', expect.objectContaining({ projectId: 'p1' }));
  });

  it('calls openToolInWorkspace with the correct toolId for changes tile', () => {
    renderEmpty();
    fireEvent.click(screen.getByText('Changes'));
    expect(openToolInWorkspace).toHaveBeenCalledWith('s1', 'session-changes', expect.objectContaining({ projectId: 'p1' }));
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
    expect(screen.getByText('Changes').closest('button')).toHaveAttribute('title', '3 files to review');
  });

  it('hides the changes count and uses the static subtitle at zero', () => {
    renderEmpty();
    expect(screen.queryByText(/to review/)).toBeNull();
    expect(screen.getByText('Changes').closest('button')).toHaveAttribute('title', 'View session changes');
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
    // Order follows plugin store registration order (terminal=0, changes=1, file=2, draft=3, lineage=4)
    expect(labels).toEqual(['Terminal', 'Changes', 'File', 'Draft', 'Lineage']);
  });

  it('does not show a panel that is disabled', () => {
    usePluginStore.setState({ disabledBuiltinPanels: ['lineage'] });
    renderEmpty();
    expect(screen.queryByText('Lineage')).toBeNull();
  });

  it('does not show a panel that is mobile-only', () => {
    usePluginStore.getState().registerPanel({
      id: 'draft',
      pluginId: 'com.zclaudia.builtin',
      type: 'panel',
      label: 'Draft',
      order: 3,
      platforms: ['mobile'],
    });
    renderEmpty();
    expect(screen.queryByText('Draft')).toBeNull();
  });
});
