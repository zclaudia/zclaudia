import { resolveProjectWorkspace } from '../projectWorkspaceActions';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePluginStore } from '../../stores/pluginStore';
import { useRightWorkspaceStore } from '../../stores/rightWorkspaceStore';
import { useRightSidebarStore } from '../../stores/rightSidebarStore';
import { useAppearanceStore } from '../../stores/appearanceStore';
import { useProjectWorkspaceStore } from '../../stores/projectWorkspaceStore';
import { useProjectStore } from '../../stores/projectStore';
import { useOwnershipStore } from '../../stores/ownershipStore';
import {
  openToolInWorkspace,
  closeToolInWorkspace,
  closeTabInWorkspace,
} from '../workspaceActions';

beforeEach(() => {
  vi.restoreAllMocks();
  useAppearanceStore.setState({ unifiedWorkspace: false });
  useProjectWorkspaceStore.setState({ byProject: {} });
  useProjectStore.setState({ sessions: [] });
  useRightWorkspaceStore.setState({ bySession: {}, order: [] });
  useRightSidebarStore.setState({
    collapsed: true,
    widthFraction: 0.26,
    activeTab: null,
    unread: false,
  });
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
    const pane = ws.root as any;
    const termTab = pane.tools.find((t: any) => t.toolId === 'terminal');
    expect(termTab.instanceKey).toBe('be::proj');
  });

  it('fires the panel onOpen lifecycle with session/project/backend on explicit open', () => {
    const calls: any[] = [];
    usePluginStore.setState({
      panels: [
        {
          id: 'memory',
          pluginId: 'x',
          type: 'panel',
          label: 'Memory',
          openMode: 'shared',
          onOpen: (ctx: any) => calls.push(ctx),
        },
      ] as any,
    });
    openToolInWorkspace('A', 'memory', { projectId: 'proj', backendId: 'be' });
    expect(calls).toEqual([{ sessionId: 'A', projectId: 'proj', backendId: 'be' }]);
  });
});

describe('closeToolInWorkspace', () => {
  it('removes the pane holding the tool', () => {
    openToolInWorkspace('A', 'memory');
    closeToolInWorkspace('A', 'memory');
    expect(useRightWorkspaceStore.getState().bySession.A.root).toBeNull();
  });
});

describe('closeTabInWorkspace', () => {
  it('passes the exact terminal instance scope without closing the other ref', () => {
    const onClose = vi.fn();
    usePluginStore.setState({ panels: [{ id: 'terminal', label: 'Terminal', onClose }] as any });
    openToolInWorkspace('A', 'terminal', { projectId: 'project', backendId: 'backend-A' });
    openToolInWorkspace('A', 'terminal', { projectId: 'project', backendId: 'backend-B' });
    const paneId = useRightWorkspaceStore.getState().bySession.A.root!.id;
    closeTabInWorkspace('A', paneId, 'terminal', 'backend-A::project');
    expect(onClose).toHaveBeenCalledWith({ sessionId: 'A', projectId: 'project', backendId: 'backend-A', instanceKey: 'backend-A::project' });
    expect((useRightWorkspaceStore.getState().bySession.A.root as any).tools).toEqual([{ toolId: 'terminal', instanceKey: 'backend-B::project' }]);
  });

  it('skips lifecycle when the store refuses a close or the ref is absent', () => {
    const onClose = vi.fn();
    usePluginStore.setState({ panels: [{ id: 'memory', label: 'Memory', onClose }] as any });
    openToolInWorkspace('A', 'memory');
    const paneId = useRightWorkspaceStore.getState().bySession.A.root!.id;
    vi.spyOn(useRightWorkspaceStore.getState(), 'closeTool').mockImplementation(() => {});
    closeTabInWorkspace('A', paneId, 'memory');
    closeTabInWorkspace('A', 'absent-pane', 'memory');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('passes a fixed tool binding rather than the selected workspace chat', () => {
    const onClose = vi.fn();
    useAppearanceStore.setState({ unifiedWorkspace: true });
    useProjectStore.setState({ sessions: [{ id: 'A', projectId: 'project' }, { id: 'B', projectId: 'project' }] as any });
    useOwnershipStore.getState().setSessionOwner('B', 'backend-B');
    const workspaceId = resolveProjectWorkspace('project', ['A', 'B'], 'A');
    usePluginStore.setState({ panels: [{ id: 'memory', label: 'Memory', onClose }] as any });
    openToolInWorkspace('A', 'memory');
    useProjectWorkspaceStore.getState().setToolBinding('project', { toolId: 'memory' }, { mode: 'fixed', sessionId: 'B' });
    const pane = (useRightWorkspaceStore.getState().bySession[workspaceId].root as any).children[1];
    closeTabInWorkspace(workspaceId, pane.id, 'memory');
    expect(onClose).toHaveBeenCalledWith({ sessionId: 'B', projectId: 'project', backendId: 'backend-B', instanceKey: undefined });
  });

  it('closes the tab via the store and runs the panel onClose hook', () => {
    let closed = 0;
    usePluginStore.setState({
      panels: [
        {
          id: 'memory',
          pluginId: 'x',
          type: 'panel',
          label: 'Memory',
          onClose: () => {
            closed++;
          },
        },
      ] as any,
    });
    openToolInWorkspace('A', 'memory');
    const paneId = useRightWorkspaceStore.getState().bySession.A.root!.id;
    closeTabInWorkspace('A', paneId, 'memory');
    expect(useRightWorkspaceStore.getState().bySession.A.root).toBeNull(); // last tab → pane gone
    expect(closed).toBe(1);
  });
});
