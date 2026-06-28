import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { usePluginStore } from '../../../stores/pluginStore';
import { useRightWorkspaceStore } from '../../../stores/rightWorkspaceStore';
import { WorkspaceView } from '../WorkspaceView';

function Dummy({ panelId }: { panelId?: string }) {
  return <div data-testid={`content-${panelId}`}>content</div>;
}

beforeEach(() => {
  useRightWorkspaceStore.setState({ bySession: {}, order: [] });
  usePluginStore.setState({
    panels: [
      { id: 'memory', pluginId: 'x', type: 'panel', label: 'Memory', component: Dummy },
      { id: 'file-viewer', pluginId: 'x', type: 'panel', label: 'File', component: Dummy },
    ] as any,
  });
});

describe('WorkspaceView', () => {
  it('renders a single pane with the active tool', () => {
    useRightWorkspaceStore.getState().openTool('A', 'memory', { openMode: 'shared' });
    const { getByTestId, getByText } = render(<WorkspaceView sessionId="A" />);
    expect(getByTestId('content-memory')).toBeTruthy();
    expect(getByText('Memory')).toBeTruthy();
  });

  it('renders both panes when split', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'memory');
    const p1 = useRightWorkspaceStore.getState().bySession.A.root!.id;
    s.splitPane('A', p1, 'row', 'file-viewer');
    const { getByTestId } = render(<WorkspaceView sessionId="A" />);
    expect(getByTestId('content-memory')).toBeTruthy();
    expect(getByTestId('content-file-viewer')).toBeTruthy();
  });

  it('renders a ResizeDivider [role=separator] between panes when split', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'memory');
    const p1 = useRightWorkspaceStore.getState().bySession.A.root!.id;
    s.splitPane('A', p1, 'row', 'file-viewer');
    const { container } = render(<WorkspaceView sessionId="A" />);
    const separator = container.querySelector('[role="separator"]');
    expect(separator).toBeTruthy();
  });

  it('renders nothing for an empty workspace', () => {
    const { container } = render(<WorkspaceView sessionId="A" />);
    expect(container.firstChild).toBeNull();
  });

  // Regression: the root must fill its (position: relative) block container. A bare
  // flex-grow is inert against a non-flex parent and collapses the workspace to
  // content height, leaving every tool mis-sized.
  it('fills its container: root is absolute inset-0 and the pane grows', () => {
    useRightWorkspaceStore.getState().openTool('A', 'memory', { openMode: 'shared' });
    const { container } = render(<WorkspaceView sessionId="A" />);
    const rootEl = container.firstChild as HTMLElement;
    expect(rootEl.className).toContain('absolute');
    expect(rootEl.className).toContain('inset-0');
    const pane = container.querySelector('[data-pane-id]') as HTMLElement;
    expect(pane.className).toContain('flex-1');
  });

  it('renders panes as cards on a seamless (non-recessed) canvas', () => {
    useRightWorkspaceStore.getState().openTool('A', 'memory', { openMode: 'shared' });
    const { container } = render(<WorkspaceView sessionId="A" />);
    const rootEl = container.firstChild as HTMLElement;
    expect(rootEl.className).not.toContain('bg-muted'); // canvas shares the chat background
    expect(rootEl.className).toContain('p-1.5');        // gutter padding around cards
    expect(rootEl.className).toContain('inset-0');      // still fills container
    const pane = container.querySelector('[data-pane-id]') as HTMLElement;
    expect(pane.className).toContain('rounded-lg'); // card
    expect(pane.className).toContain('border');
    expect(pane.className).toContain('bg-card');
  });
});
