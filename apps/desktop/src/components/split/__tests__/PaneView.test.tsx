import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PaneView } from '../PaneView';
import { useSplitLayoutStore } from '../../../stores/splitLayoutStore';
import { usePluginStore, type UIExtension } from '../../../stores/pluginStore';

// Capture what PanelContent receives by mocking it.
let lastPanelContentProps: Record<string, unknown> | null = null;
vi.mock('../../panels/PanelRenderer', () => ({
  PanelContent: (props: Record<string, unknown>) => {
    lastPanelContentProps = props;
    return <div data-testid="panel-content" />;
  },
  PanelActions: () => <div data-testid="panel-actions" />,
}));

function makePanel(overrides: Partial<UIExtension> = {}): UIExtension {
  return {
    id: 'terminal',
    pluginId: 'com.test',
    type: 'panel',
    label: 'Terminal',
    order: 0,
    ...overrides,
  };
}

function setPanels(panels: UIExtension[]) {
  usePluginStore.setState({ panels });
}

describe('PaneView', () => {
  beforeEach(() => {
    useSplitLayoutStore.setState({ root: null, focusedPaneId: null });
    lastPanelContentProps = null;
  });
  afterEach(() => cleanup());

  it('renders the panel label and a close button', () => {
    setPanels([makePanel({ label: 'Memory' })]);
    useSplitLayoutStore.getState().initSingle('terminal');
    const root = useSplitLayoutStore.getState().root!;
    render(
      <PaneView
        paneId={root.id}
        focused
        projectId="p1"
        projectRoot="/root"
        workingDirectory="/root"
      />,
    );
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByTitle('Close pane')).toBeInTheDocument();
  });

  it('passes panel/projectId/projectRoot/workingDirectory to PanelContent', () => {
    setPanels([makePanel()]);
    useSplitLayoutStore.getState().initSingle('terminal');
    const root = useSplitLayoutStore.getState().root!;
    render(
      <PaneView
        paneId={root.id}
        focused
        projectId="p1"
        projectRoot="/root"
        workingDirectory="/root/wd"
      />,
    );
    expect(lastPanelContentProps).toMatchObject({
      projectRoot: '/root',
      workingDirectory: '/root/wd',
    });
    expect(lastPanelContentProps!.panel).toMatchObject({ id: 'terminal' });
  });

  it('decodes a terminal pane instanceKey (backend::projectId) into projectId', () => {
    setPanels([makePanel({ id: 'terminal' })]);
    // Build a terminal pane with a scoped instanceKey.
    useSplitLayoutStore.setState({
      root: { id: 'pane_t1', kind: 'pane', panelId: 'terminal', instanceKey: 'backendX::projA' },
      focusedPaneId: 'pane_t1',
    });
    render(
      <PaneView
        paneId="pane_t1"
        focused
        projectId="p1"
        projectRoot="/root"
        workingDirectory="/root"
      />,
    );
    expect(lastPanelContentProps!.projectId).toBe('projA');
  });

  it('falls back to the passed projectId when instanceKey is absent', () => {
    setPanels([makePanel({ id: 'memory' })]);
    useSplitLayoutStore.setState({
      root: { id: 'pane_m1', kind: 'pane', panelId: 'memory' },
      focusedPaneId: 'pane_m1',
    });
    render(
      <PaneView paneId="pane_m1" focused projectId="p1" projectRoot="/r" workingDirectory="/r" />
    );
    expect(lastPanelContentProps!.projectId).toBe('p1');
  });

  it('calls closePane when the close button is clicked', () => {
    setPanels([makePanel()]);
    useSplitLayoutStore.getState().initSingle('terminal');
    const root = useSplitLayoutStore.getState().root!;
    render(
      <PaneView paneId={root.id} focused projectId="p1" projectRoot="/r" workingDirectory="/r" />
    );
    fireEvent.click(screen.getByTitle('Close pane'));
    expect(useSplitLayoutStore.getState().root).toBeNull();
  });

  it('marks itself focused via data-focused and calls focusPane on pointer down the body', () => {
    setPanels([makePanel()]);
    useSplitLayoutStore.getState().initSingle('terminal');
    const root = useSplitLayoutStore.getState().root!;
    const { container } = render(
      <PaneView paneId={root.id} focused={false} projectId="p1" projectRoot="/r" workingDirectory="/r" />
    );
    const paneEl = container.querySelector('[data-pane-id]') as HTMLElement;
    expect(paneEl.getAttribute('data-focused')).toBe('false');
    fireEvent.pointerDown(paneEl);
    expect(useSplitLayoutStore.getState().focusedPaneId).toBe(root.id);
  });
});
