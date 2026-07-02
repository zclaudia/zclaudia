// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { usePluginStore } from '../../stores/pluginStore';
import { useRightSidebarStore } from '../../stores/rightSidebarStore';
import { useRightWorkspaceStore } from '../../stores/rightWorkspaceStore';

vi.mock('../../hooks/useMediaQuery', () => ({
  useIsMobile: vi.fn().mockReturnValue(false),
}));

vi.mock('../RightSidebarEmptyState', () => ({
  RightSidebarEmptyState: () => <div data-testid="empty-state" />,
}));

vi.mock('../workspace/WorkspaceView', () => ({
  WorkspaceView: ({ sessionId }: any) => (
    <div data-testid="workspace-view">WorkspaceView:{sessionId}</div>
  ),
}));

import { RightSidebar } from '../RightSidebar';
import { useIsMobile } from '../../hooks/useMediaQuery';

const DummyMemoryPanel = () => <div data-testid="memory-panel">Memory</div>;

describe('RightSidebar', () => {
  beforeEach(() => {
    useRightWorkspaceStore.setState({ bySession: {}, order: [] });
    useRightSidebarStore.setState({
      widthFraction: 0.26,
      activeTab: null,
      collapsed: false,
      unread: false,
    });
    usePluginStore.setState({ panels: [], panelPlacements: {}, disabledBuiltinPanels: [] });
    (useIsMobile as any).mockReturnValue(false);

    // Register panels: memory (no iconKey mapping → won't appear in empty-state tiles)
    // plus the tile panels so the empty-state can render.
    usePluginStore.getState().registerPanel({
      id: 'memory',
      pluginId: 'com.zclaudia.memory',
      type: 'panel',
      label: 'Memory',
      component: DummyMemoryPanel,
      order: 0,
      platforms: ['desktop'],
    });
    usePluginStore.getState().registerPanel({
      id: 'file-viewer',
      pluginId: 'com.zclaudia.builtin',
      type: 'panel',
      label: 'File',
      order: 1,
      platforms: ['desktop'],
    });
    usePluginStore.getState().registerPanel({
      id: 'terminal',
      pluginId: 'com.zclaudia.builtin',
      type: 'panel',
      label: 'Terminal',
      order: 2,
      platforms: ['desktop'],
    });
    usePluginStore.getState().registerPanel({
      id: 'session-changes',
      pluginId: 'com.zclaudia.builtin',
      type: 'panel',
      label: 'Changes',
      order: 3,
      platforms: ['desktop'],
    });
  });

  it('returns null on mobile', () => {
    (useIsMobile as any).mockReturnValue(true);
    useRightWorkspaceStore.getState().openTool('A', 'memory', { openMode: 'shared' });

    const { container } = render(<RightSidebar sessionId="A" projectId="p1" projectRoot="/test" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when collapsed=true', () => {
    useRightSidebarStore.setState({ collapsed: true });
    const { container } = render(<RightSidebar sessionId="A" projectId="p1" projectRoot="/test" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the empty-state launcher when not collapsed and workspace is empty', () => {
    const { getByTestId } = render(
      <RightSidebar sessionId="A" projectId="p1" projectRoot="/test" />
    );
    expect(getByTestId('empty-state')).toBeTruthy();
  });

  it('renders the workspace without a separate "Workspace" header row', () => {
    useRightWorkspaceStore.getState().openTool('A', 'memory', { openMode: 'shared' });
    const { getByTestId, queryByText } = render(
      <RightSidebar sessionId="A" projectId="p1" projectRoot="/test" />
    );
    expect(getByTestId('workspace-view')).toBeTruthy();
    expect(queryByText('Workspace')).toBeNull();
  });

  it('uses widthFraction from store as the sidebar width (proportional)', () => {
    useRightSidebarStore.setState({ widthFraction: 0.3, activeTab: null, collapsed: false });

    const { container } = render(<RightSidebar sessionId="A" projectId="p1" projectRoot="/test" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.width).toBe('30%');
    expect(wrapper.style.minWidth).toBe('240px');
  });

  it('renders the empty-state for a session with no open tools', () => {
    useRightWorkspaceStore.getState().openTool('B', 'memory', { openMode: 'shared' });
    const { getByTestId } = render(
      <RightSidebar sessionId="A" projectId="p1" projectRoot="/test" />
    );
    // Session A has no tools open → empty-state is shown (not null)
    expect(getByTestId('empty-state')).toBeTruthy();
  });
});
