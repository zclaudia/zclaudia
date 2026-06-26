import { describe, it, expect, beforeEach } from 'vitest';
import { usePluginStore } from '../../stores/pluginStore';
import { useRightWorkspaceStore } from '../../stores/rightWorkspaceStore';
import { useRightSidebarStore } from '../../stores/rightSidebarStore';
import { openToolInWorkspace, closeToolInWorkspace } from '../workspaceActions';

beforeEach(() => {
  useRightWorkspaceStore.setState({ bySession: {}, order: [] });
  useRightSidebarStore.setState({ collapsed: true, widthFraction: 0.26, activeTab: null, unread: false });
  usePluginStore.setState({
    panels: [
      { id: 'memory', pluginId: 'x', type: 'panel', label: 'Memory', openMode: 'shared' },
      { id: 'terminal', pluginId: 'x', type: 'panel', label: 'Terminal', openMode: 'dedicated' },
    ] as any,
  });
});

describe('openToolInWorkspace', () => {
  it('routes a shared tool to the primary pane', () => {
    openToolInWorkspace('A', 'memory');
    const ws = useRightWorkspaceStore.getState().bySession.A;
    expect((ws.root as any).activeToolId).toBe('memory');
    expect(ws.primaryPaneId).toBe(ws.root!.id);
  });

  it('sets collapsed=false in rightSidebarStore', () => {
    useRightSidebarStore.setState({ collapsed: true });
    openToolInWorkspace('A', 'memory');
    expect(useRightSidebarStore.getState().collapsed).toBe(false);
  });

  it('builds a terminal instanceKey from project + backend', () => {
    openToolInWorkspace('A', 'memory'); // seed primary
    openToolInWorkspace('A', 'terminal', { projectId: 'proj', backendId: 'be' });
    const ws = useRightWorkspaceStore.getState().bySession.A;
    const termPane = (ws.root as any).children.find((c: any) => c.activeToolId === 'terminal');
    expect(termPane.tools[0].instanceKey).toBe('be::proj');
  });
});

describe('closeToolInWorkspace', () => {
  it('removes the pane holding the tool', () => {
    openToolInWorkspace('A', 'memory');
    closeToolInWorkspace('A', 'memory');
    expect(useRightWorkspaceStore.getState().bySession.A.root).toBeNull();
  });
});
