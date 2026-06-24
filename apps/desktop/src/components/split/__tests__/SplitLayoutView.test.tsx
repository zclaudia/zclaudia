import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SplitLayoutView } from '../SplitLayoutView';
import {
  useSplitLayoutStore,
  type PaneNode,
  type GroupNode,
} from '../../../stores/splitLayoutStore';

// Track PaneView / ResizeDivider mounts so we can assert tree structure.
let mountedPanes: string[] = [];
let dividerDirs: ('row' | 'col')[] = [];

vi.mock('../PaneView', () => ({
  PaneView: ({ paneId }: { paneId: string }) => {
    mountedPanes.push(paneId);
    return <div data-testid={`pane-${paneId}`} />;
  },
}));
vi.mock('../ResizeDivider', () => ({
  ResizeDivider: ({
    dir,
    onDrag,
    groupId,
  }: {
    dir: 'row' | 'col';
    onDrag: (d: number) => void;
    groupId: string;
  }) => {
    dividerDirs.push(dir);
    return (
      <div
        data-testid={`divider-${groupId}`}
        onClick={() => onDrag(0.1)}
      />
    );
  },
}));

function reset() {
  mountedPanes = [];
  dividerDirs = [];
}

describe('SplitLayoutView', () => {
  beforeEach(() => {
    useSplitLayoutStore.setState({ root: null, focusedPaneId: null });
    reset();
  });
  afterEach(() => cleanup());

  it('renders a single pane with no divider', () => {
    useSplitLayoutStore.setState({
      root: { id: 'p1', kind: 'pane', panelId: 'terminal' } as PaneNode,
      focusedPaneId: 'p1',
    });
    render(<SplitLayoutView projectId="s" projectRoot="/r" workingDirectory="/r" />);
    expect(screen.getByTestId('pane-p1')).toBeInTheDocument();
    expect(screen.queryByTestId(/divider-/)).toBeNull();
  });

  it('renders a row group with two panes and one row divider', () => {
    useSplitLayoutStore.setState({
      root: {
        id: 'g1', kind: 'group', dir: 'row', ratio: 0.5,
        children: [
          { id: 'p1', kind: 'pane', panelId: 'terminal' },
          { id: 'p2', kind: 'pane', panelId: 'memory' },
        ],
      } as GroupNode,
      focusedPaneId: 'p1',
    });
    render(<SplitLayoutView projectId="s" projectRoot="/r" workingDirectory="/r" />);
    expect(mountedPanes).toEqual(['p1', 'p2']);
    expect(dividerDirs).toEqual(['row']);
  });

  it('renders a col group with a col divider', () => {
    useSplitLayoutStore.setState({
      root: {
        id: 'g1', kind: 'group', dir: 'col', ratio: 0.5,
        children: [
          { id: 'p1', kind: 'pane', panelId: 'terminal' },
          { id: 'p2', kind: 'pane', panelId: 'memory' },
        ],
      } as GroupNode,
      focusedPaneId: 'p1',
    });
    render(<SplitLayoutView projectId="s" projectRoot="/r" workingDirectory="/r" />);
    expect(dividerDirs).toEqual(['col']);
  });

  it('renders nested groups recursively, each with its own divider', () => {
    useSplitLayoutStore.setState({
      root: {
        id: 'g1', kind: 'group', dir: 'row', ratio: 0.5,
        children: [
          { id: 'p1', kind: 'pane', panelId: 'terminal' },
          {
            id: 'g2', kind: 'group', dir: 'col', ratio: 0.5,
            children: [
              { id: 'p2', kind: 'pane', panelId: 'memory' },
              { id: 'p3', kind: 'pane', panelId: 'draft' },
            ],
          },
        ],
      } as GroupNode,
      focusedPaneId: 'p1',
    });
    render(<SplitLayoutView projectId="s" projectRoot="/r" workingDirectory="/r" />);
    expect(mountedPanes).toEqual(['p1', 'p2', 'p3']);
    expect(dividerDirs).toEqual(['row', 'col']); // outer divider mounts before the inner group
  });

  it('dragging a divider calls setRatio for that group only', () => {
    useSplitLayoutStore.setState({
      root: {
        id: 'g1', kind: 'group', dir: 'row', ratio: 0.5,
        children: [
          { id: 'p1', kind: 'pane', panelId: 'terminal' },
          { id: 'p2', kind: 'pane', panelId: 'memory' },
        ],
      } as GroupNode,
      focusedPaneId: 'p1',
    });
    render(<SplitLayoutView projectId="s" projectRoot="/r" workingDirectory="/r" />);
    const before = (useSplitLayoutStore.getState().root as GroupNode).ratio;
    screen.getByTestId('divider-g1').click();
    const after = (useSplitLayoutStore.getState().root as GroupNode).ratio;
    expect(after).not.toBe(before);
    expect(after).toBeCloseTo(before + 0.1, 5);
  });

  it('renders nothing when root is null', () => {
    useSplitLayoutStore.setState({ root: null, focusedPaneId: null });
    const { container } = render(<SplitLayoutView projectId="s" projectRoot="/r" workingDirectory="/r" />);
    expect(container.firstChild).toBeNull();
  });
});
