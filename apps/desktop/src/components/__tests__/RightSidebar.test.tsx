// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
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
  WorkspaceView: ({ sessionId }: any) => <div data-testid="workspace-view">WorkspaceView:{sessionId}</div>,
}));

import { RightSidebar } from '../RightSidebar';
import { useIsMobile } from '../../hooks/useMediaQuery';

const DummyMemoryPanel = () => <div data-testid="memory-panel">Memory</div>;

describe('RightSidebar', () => {
  beforeEach(() => {
    usePluginStore.setState({ panels: [], panelPlacements: {}, disabledBuiltinPanels: [] });
    useRightSidebarStore.setState({ widthFraction: 0.26, activeTab: null, collapsed: false, unread: false });
    useRightWorkspaceStore.setState({ bySession: {}, order: [] });
    (useIsMobile as any).mockReturnValue(false);

    // Register a Dummy 'memory' panel so openTool can resolve it.
    usePluginStore.getState().registerPanel({
      id: 'memory',
      pluginId: 'com.zclaudia.memory',
      type: 'panel',
      label: 'Memory',
      component: DummyMemoryPanel,
      order: 0,
      platforms: ['desktop'],
    });
  });

  it('returns null on mobile', () => {
    (useIsMobile as any).mockReturnValue(true);
    useRightWorkspaceStore.getState().openTool('A', 'memory', { openMode: 'shared' });

    const { container } = render(<RightSidebar sessionId="A" projectId="p1" projectRoot="/test" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the session workspace is empty', () => {
    const { container } = render(<RightSidebar sessionId="A" projectId="p1" projectRoot="/test" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the workspace when a tool is open', () => {
    useRightWorkspaceStore.getState().openTool('A', 'memory', { openMode: 'shared' });
    const { getByText } = render(<RightSidebar sessionId="A" projectId="p1" projectRoot="/test" />);
    expect(getByText('Workspace')).toBeTruthy();
  });

  it('uses widthFraction from store as the sidebar width (proportional)', () => {
    useRightWorkspaceStore.getState().openTool('A', 'memory', { openMode: 'shared' });
    useRightSidebarStore.setState({ widthFraction: 0.3, activeTab: null });

    const { container } = render(<RightSidebar sessionId="A" projectId="p1" projectRoot="/test" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.width).toBe('30%');
    expect(wrapper.style.minWidth).toBe('240px');
  });

  it('renders nothing for a different session with empty workspace', () => {
    useRightWorkspaceStore.getState().openTool('B', 'memory', { openMode: 'shared' });
    const { container } = render(<RightSidebar sessionId="A" projectId="p1" projectRoot="/test" />);
    expect(container.firstChild).toBeNull();
  });
});
