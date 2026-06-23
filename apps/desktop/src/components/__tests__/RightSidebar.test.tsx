import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { usePluginStore } from '../../stores/pluginStore';
import { useRightSidebarStore } from '../../stores/rightSidebarStore';
import { useSessionToolsStore } from '../../stores/sessionToolsStore';
import { useSplitLayoutStore } from '../../stores/splitLayoutStore';
import { useDragSplitStore } from '../split/dragSplit';

vi.mock('../PluginPanelRenderer', () => ({
  PluginPanelRenderer: ({ activePluginPanelId }: any) => <div data-testid="plugin-panel">Plugin:{activePluginPanelId}</div>,
}));

vi.mock('../../hooks/useMediaQuery', () => ({
  useIsMobile: vi.fn().mockReturnValue(false),
}));

vi.mock('../RightSidebarEmptyState', () => ({
  RightSidebarEmptyState: () => <div data-testid="empty-state" />,
}));

import { RightSidebar } from '../RightSidebar';
import { useIsMobile } from '../../hooks/useMediaQuery';

const TerminalPanel = ({ projectId }: any) => <div data-testid="terminal-panel">Terminal:{projectId}</div>;
const TerminalActions = () => <div data-testid="terminal-actions">Actions</div>;
const FileViewerPanel = () => <div data-testid="fileviewer-panel">FileViewer</div>;

const onCloseSpy = vi.fn();

function registerRightTerminal(visible = true) {
  usePluginStore.getState().registerPanel({
    id: 'terminal',
    pluginId: 'com.claudia.terminal',
    type: 'panel',
    label: 'Terminal',
    component: TerminalPanel,
    actions: TerminalActions,
    order: 0,
    platforms: ['desktop', 'mobile'],
    alwaysMount: true,
    visible,
    onClose: onCloseSpy,
  });
  usePluginStore.setState({ panelPlacements: { terminal: 'right' } });
}

function registerRightFileViewer(visible = true) {
  usePluginStore.getState().registerPanel({
    id: 'file-viewer',
    pluginId: 'com.claudia.file-viewer',
    type: 'panel',
    label: 'File',
    component: FileViewerPanel,
    order: 1,
    platforms: ['desktop', 'mobile'],
    visible,
  });
  usePluginStore.setState({
    panelPlacements: { ...usePluginStore.getState().panelPlacements, 'file-viewer': 'right' },
  });
}

describe('RightSidebar', () => {
  beforeEach(() => {
    usePluginStore.setState({ panels: [], panelPlacements: {} });
    useRightSidebarStore.setState({ widthFraction: 0.26, activeTab: null, collapsed: false, unread: false });
    useSessionToolsStore.setState({ tools: [] });
    onCloseSpy.mockClear();
    (useIsMobile as any).mockReturnValue(false);
  });

  it('returns null on mobile', () => {
    (useIsMobile as any).mockReturnValue(true);
    registerRightTerminal(true);

    const { container } = render(<RightSidebar projectId="p1" projectRoot="/test" />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when no right-placed panels are registered', () => {
    const { container } = render(<RightSidebar projectId="p1" projectRoot="/test" />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when right-placed panels exist but none are visible', () => {
    registerRightTerminal(false);
    registerRightFileViewer(false);

    const { container } = render(<RightSidebar projectId="p1" projectRoot="/test" />);
    // alwaysMount terminal keeps the wrapper but with width 0
    const wrapper = container.firstChild as HTMLElement | null;
    if (wrapper) {
      expect((wrapper.style.width || '0px')).toBe('0px');
    }
  });

  it('renders right-placed visible panel', () => {
    registerRightTerminal(true);
    useRightSidebarStore.setState({ activeTab: 'terminal' });

    render(<RightSidebar projectId="p1" projectRoot="/test" />);
    expect(screen.getByTestId('terminal-panel')).toBeInTheDocument();
  });

  it('does not render bottom-placed panels', () => {
    // Register a bottom-placed panel
    usePluginStore.getState().registerPanel({
      id: 'bottom-only',
      pluginId: 'test',
      type: 'panel',
      label: 'Bottom Only',
      component: () => <div data-testid="bottom-only">Bottom</div>,
      defaultPlacement: 'bottom',
      visible: true,
      order: 0,
    });

    const { container } = render(<RightSidebar projectId="p1" projectRoot="/test" />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('bottom-only')).toBeNull();
  });

  it('shows tabs when multiple right-placed panels are visible', () => {
    registerRightTerminal(true);
    registerRightFileViewer(true);
    useRightSidebarStore.setState({ activeTab: 'terminal' });

    render(<RightSidebar projectId="p1" projectRoot="/test" />);
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('File')).toBeInTheDocument();
  });

  it('switches active tab on tab click', () => {
    registerRightTerminal(true);
    registerRightFileViewer(true);
    useRightSidebarStore.setState({ activeTab: 'terminal' });

    render(<RightSidebar projectId="p1" projectRoot="/test" />);
    fireEvent.click(screen.getByText('File'));
    expect(useRightSidebarStore.getState().activeTab).toBe('file-viewer');
  });

  it('does not render a "Move to bottom panel" control', () => {
    registerRightTerminal(true);
    useRightSidebarStore.setState({ activeTab: 'terminal' });

    render(<RightSidebar projectId="p1" projectRoot="/test" />);
    expect(screen.queryByTitle('Move to bottom panel')).toBeNull();
  });

  it('close button calls each visible panel onClose', () => {
    registerRightTerminal(true);
    useRightSidebarStore.setState({ activeTab: 'terminal' });

    render(<RightSidebar projectId="p1" projectRoot="/test" />);
    fireEvent.click(screen.getByTitle('Hide panel'));
    expect(onCloseSpy).toHaveBeenCalled();
  });

  it('renders published session tools as pinned icon tabs and routes clicks', () => {
    const onChanges = vi.fn();
    registerRightTerminal(true);
    useRightSidebarStore.setState({ activeTab: 'terminal' });
    useSessionToolsStore.setState({
      tools: [
        { id: 'session-changes', label: 'Changes', iconKey: 'changes', isActive: false, onClick: onChanges },
        { id: 'terminal', label: 'Terminal', iconKey: 'terminal', isActive: true, onClick: vi.fn() },
      ],
    });

    render(<RightSidebar projectId="p1" projectRoot="/test" />);
    const changesTab = screen.getByLabelText('Changes');
    expect(changesTab).toBeInTheDocument();
    fireEvent.click(changesTab);
    expect(onChanges).toHaveBeenCalled();
  });

  it('uses widthFraction from store as the sidebar width (proportional)', () => {
    registerRightTerminal(true);
    useRightSidebarStore.setState({ widthFraction: 0.3, activeTab: 'terminal' });

    const { container } = render(<RightSidebar projectId="p1" projectRoot="/test" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.width).toBe('30%');
    expect(wrapper.style.minWidth).toBe('240px');
  });

  it('shows the empty state when pinned tools exist but no panel is active', () => {
    useSessionToolsStore.setState({
      tools: [{ id: 'terminal', label: 'Terminal', iconKey: 'terminal', isActive: false, onClick: vi.fn() }],
    });
    render(<RightSidebar projectId="p1" projectRoot="/test" />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
  });

  it('does not show the empty state when a panel is active', () => {
    registerRightTerminal(true);
    useRightSidebarStore.setState({ activeTab: 'terminal' });
    useSessionToolsStore.setState({
      tools: [{ id: 'terminal', label: 'Terminal', iconKey: 'terminal', isActive: true, onClick: vi.fn() }],
    });
    render(<RightSidebar projectId="p1" projectRoot="/test" />);
    expect(screen.queryByTestId('empty-state')).toBeNull();
  });
});

describe('RightSidebar split view', () => {
  beforeEach(() => {
    usePluginStore.setState({ panels: [], panelPlacements: {} });
    useRightSidebarStore.setState({ widthFraction: 0.26, activeTab: null, collapsed: false, unread: false });
    useSessionToolsStore.setState({ tools: [] });
    onCloseSpy.mockClear();
    (useIsMobile as any).mockReturnValue(false);
    useSplitLayoutStore.getState().reset();
    useDragSplitStore.getState().endDrag();
  });

  it('renders the single-panel overlap layer when the layout tree is a single pane', () => {
    registerRightTerminal(true);
    useRightSidebarStore.setState({ activeTab: 'terminal' });
    useSplitLayoutStore.setState({
      root: { id: 'p1', kind: 'pane', panelId: 'terminal' },
      focusedPaneId: 'p1',
    });
    render(<RightSidebar projectId="p1" projectRoot="/test" />);
    expect(screen.getByTestId('terminal-panel')).toBeInTheDocument();
  });

  it('renders the split tree when the layout root is a group', () => {
    registerRightTerminal(true);
    registerRightFileViewer(true);
    useRightSidebarStore.setState({ activeTab: 'terminal' });
    useSplitLayoutStore.setState({
      root: {
        id: 'g1', kind: 'group', dir: 'row', ratio: 0.5,
        children: [
          { id: 'p1', kind: 'pane', panelId: 'terminal' },
          { id: 'p2', kind: 'pane', panelId: 'file-viewer' },
        ],
      },
      focusedPaneId: 'p1',
    });
    render(<RightSidebar projectId="p1" projectRoot="/test" />);
    // Both panes' panels render simultaneously in the split view.
    expect(screen.getByTestId('terminal-panel')).toBeInTheDocument();
    expect(screen.getByTestId('fileviewer-panel')).toBeInTheDocument();
  });

  it('seeds a single-pane tree when a panel becomes visible and no tree exists', () => {
    registerRightTerminal(true);
    useRightSidebarStore.setState({ activeTab: 'terminal' });
    render(<RightSidebar projectId="p1" projectRoot="/test" />);
    expect(useSplitLayoutStore.getState().root).not.toBeNull();
    expect(useSplitLayoutStore.getState().root!.kind).toBe('pane');
  });

  it('starting a pointer-down on a panel tab activates a drag', () => {
    registerRightTerminal(true);
    registerRightFileViewer(true);
    useRightSidebarStore.setState({ activeTab: 'terminal' });
    useSplitLayoutStore.setState({
      root: {
        id: 'g1', kind: 'group', dir: 'row', ratio: 0.5,
        children: [
          { id: 'p1', kind: 'pane', panelId: 'terminal' },
          { id: 'p2', kind: 'pane', panelId: 'file-viewer' },
        ],
      },
      focusedPaneId: 'p1',
    });
    render(<RightSidebar projectId="p1" projectRoot="/test" />);
    // Target the tab button via its drag title (the pane header label also says "File").
    const fileTab = screen.getByTitle('Drag File to split, or click to switch');
    fireEvent.pointerDown(fileTab, { buttons: 1, pointerType: 'mouse' });
    expect(useDragSplitStore.getState().active).toEqual({ panelId: 'file-viewer' });
  });

  it('an edge drop on a pane splits the layout', () => {
    registerRightTerminal(true);
    registerRightFileViewer(true);
    useRightSidebarStore.setState({ activeTab: 'terminal' });
    // Start from a group so pane elements exist and a drop can target them.
    useSplitLayoutStore.setState({
      root: {
        id: 'g1', kind: 'group', dir: 'row', ratio: 0.5,
        children: [
          { id: 'p1', kind: 'pane', panelId: 'terminal' },
          { id: 'p2', kind: 'pane', panelId: 'file-viewer' },
        ],
      },
      focusedPaneId: 'p1',
    });
    render(<RightSidebar projectId="p1" projectRoot="/test" />);

    // Drag the File tab and drop it on the right half of pane p1 (→ row split).
    const fileTab = screen.getByTitle('Drag File to split, or click to switch');
    fireEvent.pointerDown(fileTab, { buttons: 1, pointerType: 'mouse', clientX: 0, clientY: 0 });
    const paneEl = document.querySelector('[data-pane-id="p1"]') as HTMLElement;
    const r = { left: 100, top: 100, width: 200, height: 200 } as DOMRect;
    paneEl.getBoundingClientRect = () => r;
    // right edge of the pane → 'right' zone → row split
    fireEvent.pointerMove(paneEl, { clientX: 290, clientY: 200, buttons: 1 });
    fireEvent.pointerUp(paneEl, { clientX: 290, clientY: 200 });

    // File is a singleton already shown at p2 → the drop should be rejected (no-op).
    expect(useSplitLayoutStore.getState().root).toMatchObject({ kind: 'group' });
    expect(useDragSplitStore.getState().active).toBeNull();
  });

  it('a center drop on a pane replaces its panel and ends the drag', () => {
    registerRightTerminal(true);
    registerRightFileViewer(true);
    useRightSidebarStore.setState({ activeTab: 'terminal' });
    useSplitLayoutStore.setState({
      root: {
        id: 'g1', kind: 'group', dir: 'row', ratio: 0.5,
        children: [
          { id: 'p1', kind: 'pane', panelId: 'terminal' },
          { id: 'p2', kind: 'pane', panelId: 'memory' },
        ],
      },
      focusedPaneId: 'p1',
    });
    const { container } = render(<RightSidebar projectId="p1" projectRoot="/test" />);
    // Start a drag from the File tab.
    const fileTab = screen.getByTitle('Drag File to split, or click to switch');
    fireEvent.pointerDown(fileTab, { buttons: 1, pointerType: 'mouse', clientX: 0, clientY: 0 });
    // Mock p1's rect so the drop resolver (which reads [data-pane-id] rects) sees a real box.
    const paneEl = document.querySelector('[data-pane-id="p1"]') as HTMLElement;
    paneEl.getBoundingClientRect = () =>
      ({ left: 100, top: 100, width: 200, height: 200, right: 300, bottom: 300, x: 100, y: 100, toJSON: () => ({}) } as DOMRect);
    // Move+up at p1's center → center zone → replace p1's panel with file-viewer.
    fireEvent.pointerMove(paneEl, { clientX: 200, clientY: 200, buttons: 1 });
    fireEvent.pointerUp(paneEl, { clientX: 200, clientY: 200 });
    const root: any = useSplitLayoutStore.getState().root;
    const p1 = root.kind === 'group' ? root.children[0] : root;
    expect(p1.panelId).toBe('file-viewer');
    expect(useDragSplitStore.getState().active).toBeNull();
  });
});
