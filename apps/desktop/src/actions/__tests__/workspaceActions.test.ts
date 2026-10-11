// @vitest-environment jsdom
import { resolveProjectWorkspace } from '../projectWorkspaceActions';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePluginStore } from '../../stores/pluginStore';
import { useRightWorkspaceStore } from '../../stores/rightWorkspaceStore';
import { useRightSidebarStore } from '../../stores/rightSidebarStore';
import { useProjectWorkspaceStore } from '../../stores/projectWorkspaceStore';
import { useProjectStore } from '../../stores/projectStore';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useWorkspaceRoutingStore } from '../../stores/workspaceRoutingStore';
import {
  openToolInWorkspace,
  closeToolInWorkspace,
  closeTabInWorkspace,
  useToolOpenState,
} from '../workspaceActions';

beforeEach(() => {
  vi.restoreAllMocks();
  useProjectWorkspaceStore.setState({ byProject: {} });
  useWorkspaceRoutingStore.setState({ registrations: [], active: null });
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

  it('ignores desktop bindings and routes while unified workspace is enabled on mobile', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    const onClose = vi.fn();
    useProjectStore.setState({ sessions: [{ id: 'A', projectId: 'project' }, { id: 'B', projectId: 'project' }] as any });
    useProjectWorkspaceStore.setState({ byProject: {
      project: { workspaceId: 'desktop-anchor', focusedChatSessionId: 'B', toolBindings: {} },
    } });
    useProjectWorkspaceStore.getState().setToolBinding('project', { toolId: 'memory' }, { mode: 'fixed', sessionId: 'B' });
    useWorkspaceRoutingStore.setState({ active: {
      workspaceId: 'desktop-anchor', sessionId: 'A', projectId: 'project', projectScoped: true,
    } });
    usePluginStore.setState({ panels: [{ id: 'memory', label: 'Memory', onClose }] as any });
    openToolInWorkspace('A', 'memory');
    const paneId = useRightWorkspaceStore.getState().bySession.A.root!.id;
    closeTabInWorkspace('A', paneId, 'memory');
    expect(onClose).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'A', projectId: 'project' }));
    expect(useRightWorkspaceStore.getState().bySession['desktop-anchor']).toBeUndefined();
  });

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

describe('useToolOpenState', () => {
  it('switches from project routing to the session layout when the viewport becomes mobile', () => {
    let mobile = false;
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
      get matches() { return mobile; }, media: query, onchange: null,
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => listeners.add(listener as (event: MediaQueryListEvent) => void),
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => listeners.delete(listener as (event: MediaQueryListEvent) => void),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => true,
    }) as MediaQueryList);
    useProjectStore.setState({ sessions: [{ id: 'A', projectId: 'project' }] as any });
    useProjectWorkspaceStore.setState({ byProject: {
      project: { workspaceId: 'anchor', focusedChatSessionId: 'A', toolBindings: {} },
    } });
    useRightWorkspaceStore.getState().openTool('anchor', 'memory');
    const { result } = renderHook(() => useToolOpenState('A', 'memory'));
    expect(result.current).toBe(true);
    act(() => {
      mobile = true;
      listeners.forEach(listener => listener({ matches: true } as MediaQueryListEvent));
    });
    expect(result.current).toBe(false);
    act(() => {
      mobile = false;
      listeners.forEach(listener => listener({ matches: false } as MediaQueryListEvent));
    });
    expect(result.current).toBe(true);
  });
});
