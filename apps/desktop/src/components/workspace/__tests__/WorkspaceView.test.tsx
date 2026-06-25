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
    s.openTool('A', 'memory', { openMode: 'shared' });
    s.openTool('A', 'file-viewer', { openMode: 'dedicated' });
    const { getByTestId } = render(<WorkspaceView sessionId="A" />);
    expect(getByTestId('content-memory')).toBeTruthy();
    expect(getByTestId('content-file-viewer')).toBeTruthy();
  });

  it('renders nothing for an empty workspace', () => {
    const { container } = render(<WorkspaceView sessionId="A" />);
    expect(container.firstChild).toBeNull();
  });
});
