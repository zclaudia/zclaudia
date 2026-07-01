import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { usePluginStore } from '../../../stores/pluginStore';
import { useRightWorkspaceStore } from '../../../stores/rightWorkspaceStore';
import { PaneTabs } from '../PaneTabs';

beforeEach(() => {
  useRightWorkspaceStore.setState({ bySession: {}, order: [] });
  usePluginStore.setState({
    panels: [
      { id: 'memory', pluginId: 'x', type: 'panel', label: 'Memory' },
      { id: 'file-viewer', pluginId: 'x', type: 'panel', label: 'Files' },
    ] as any,
    disabledBuiltinPanels: [],
  });
});

function seedPane() {
  const s = useRightWorkspaceStore.getState();
  s.openTool('A', 'memory');
  s.openTool('A', 'file-viewer'); // [memory, files], active = files
  return useRightWorkspaceStore.getState().bySession.A.root as any;
}

describe('PaneTabs', () => {
  it('renders a tab per tool with the active one marked', () => {
    const pane = seedPane();
    const { getByText } = render(<PaneTabs sessionId="A" pane={pane} focused />);
    expect(getByText('Memory')).toBeTruthy();
    const filesTab = getByText('Files').closest('[data-tab-index]') as HTMLElement;
    expect(filesTab.getAttribute('data-active')).toBe('true');
    // Active tab carries the underline accent bar (not a pill/ring).
    expect(filesTab.className).toContain('shadow-[inset_0_-2px_0_hsl(var(--muted-foreground))]');
  });

  it('clicking a tab activates it', () => {
    const pane = seedPane();
    const { getByText } = render(<PaneTabs sessionId="A" pane={pane} focused />);
    fireEvent.click(getByText('Memory'));
    expect((useRightWorkspaceStore.getState().bySession.A.root as any).activeToolId).toBe('memory');
  });

  it('clicking a tab close button closes that tab', () => {
    const pane = seedPane();
    const { getByLabelText } = render(<PaneTabs sessionId="A" pane={pane} focused />);
    fireEvent.click(getByLabelText('Close Memory'));
    const root = useRightWorkspaceStore.getState().bySession.A.root as any;
    expect(root.tools.map((t: any) => t.toolId)).toEqual(['file-viewer']);
  });

  it('clicking + opens the tool launcher menu (JS layer works)', () => {
    usePluginStore.setState({
      panels: [
        { id: 'memory', pluginId: 'x', type: 'panel', label: 'Memory' },
        { id: 'file-viewer', pluginId: 'x', type: 'panel', label: 'Files' },
        { id: 'terminal', pluginId: 'x', type: 'panel', label: 'Terminal' },
      ] as any,
      disabledBuiltinPanels: [],
    });
    const pane = seedPane(); // opens memory + file-viewer as tabs (terminal stays unopened)
    const { getByLabelText } = render(<PaneTabs sessionId="A" pane={pane} focused />);
    // Menu portals to document.body → query via screen. Terminal isn't an open tab.
    expect(screen.queryByText('Terminal')).toBeNull();
    fireEvent.click(getByLabelText('Add tool'));
    expect(screen.getByText('Terminal')).toBeTruthy(); // launcher menu lists registered panels
  });

  it('keeps the + launcher outside the horizontally-scrolling tab area (its menu must not be clipped)', () => {
    const pane = seedPane();
    const { getByLabelText, container } = render(<PaneTabs sessionId="A" pane={pane} focused />);
    const addBtn = getByLabelText('Add tool');
    const scroller = container.querySelector('.overflow-x-auto');
    expect(scroller).toBeTruthy();
    // The launcher menu drops below the strip; if it lives under the overflow-scroll
    // element, that element clips it (overflow-x:auto forces overflow-y:auto).
    expect(scroller?.contains(addBtn)).toBe(false);
  });

  it('exposes a trailing window-drag region (strip is the topmost row)', () => {
    const pane = seedPane();
    const { container } = render(<PaneTabs sessionId="A" pane={pane} focused />);
    expect(container.querySelector('[data-tauri-drag-region]')).toBeTruthy();
  });

  it("renders the active tool's action buttons in the strip", () => {
    const Actions = () => <button aria-label="Tool action">A</button>;
    usePluginStore.setState({
      panels: [
        { id: 'memory', pluginId: 'x', type: 'panel', label: 'Memory' },
        { id: 'file-viewer', pluginId: 'x', type: 'panel', label: 'Files', actions: Actions },
      ] as any,
      disabledBuiltinPanels: [],
    });
    const pane = seedPane(); // active = file-viewer
    const { getByLabelText } = render(<PaneTabs sessionId="A" pane={pane} focused />);
    expect(getByLabelText('Tool action')).toBeTruthy();
  });

  it("pins the active tool's action area to the right edge of the strip", () => {
    const Actions = () => <button aria-label="Tool action">A</button>;
    usePluginStore.setState({
      panels: [
        { id: 'memory', pluginId: 'x', type: 'panel', label: 'Memory' },
        { id: 'file-viewer', pluginId: 'x', type: 'panel', label: 'Files', actions: Actions },
      ] as any,
      disabledBuiltinPanels: [],
    });
    const pane = seedPane(); // active = file-viewer
    const { container } = render(<PaneTabs sessionId="A" pane={pane} focused />);
    const strip = container.querySelector('[data-tab-strip]') as HTMLElement;
    const actions = container.querySelector('[data-pane-actions]') as HTMLElement;

    expect(actions).toBeTruthy();
    expect(strip.lastElementChild).toBe(actions);
    expect(actions.className).toContain('ml-auto');
  });

  it('shows only the active tool\'s actions, not an inactive tab\'s', () => {
    const Actions = () => <button aria-label="Tool action">A</button>;
    usePluginStore.setState({
      panels: [
        { id: 'memory', pluginId: 'x', type: 'panel', label: 'Memory' },
        { id: 'file-viewer', pluginId: 'x', type: 'panel', label: 'Files', actions: Actions },
      ] as any,
      disabledBuiltinPanels: [],
    });
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'file-viewer');
    s.openTool('A', 'memory'); // active = memory (no actions)
    const pane = useRightWorkspaceStore.getState().bySession.A.root as any;
    const { queryByLabelText } = render(<PaneTabs sessionId="A" pane={pane} focused />);
    expect(queryByLabelText('Tool action')).toBeNull();
  });

  it('shows edge scroll chevrons only for the overflowing side, and clicking scrolls', () => {
    const pane = seedPane();
    const { container, getByLabelText, queryByLabelText } = render(
      <PaneTabs sessionId="A" pane={pane} focused />,
    );
    const scroller = container.querySelector('.overflow-x-auto') as HTMLElement;
    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy as any;
    // jsdom has no layout: fake an overflowing, scrolled-to-start tab list.
    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 500 });
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 100 });
    scroller.scrollLeft = 0;
    fireEvent.scroll(scroller);

    // At the start edge: only the right chevron is offered.
    expect(queryByLabelText('Scroll tabs left')).toBeNull();
    fireEvent.click(getByLabelText('Scroll tabs right'));
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: expect.any(Number) }));
    expect(scrollBy.mock.calls[0][0].left).toBeGreaterThan(0);

    // Scrolled into the middle: both edges are reachable.
    scroller.scrollLeft = 200;
    fireEvent.scroll(scroller);
    expect(queryByLabelText('Scroll tabs left')).not.toBeNull();
    expect(queryByLabelText('Scroll tabs right')).not.toBeNull();
  });
});
