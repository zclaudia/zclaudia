import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceStorageKey } from '../workspaceRoutingStore';

const originalLocation = window.location;

beforeEach(() => localStorage.clear());
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: originalLocation });
  vi.resetModules();
});

function setSearch(search: string) {
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { ...originalLocation, search } });
}

function layout(sessionId: string) {
  const root = { id: `pane-${sessionId}`, kind: 'pane', tools: [{ toolId: 'chat', instanceKey: sessionId }],
    activeToolId: 'chat', activeInstanceKey: sessionId };
  return { root, primaryPaneId: null, focusedPaneId: root.id };
}

function savedLayouts(sessionId: string) {
  return JSON.stringify({ version: 3, state: { bySession: { [sessionId]: layout(sessionId) }, order: [sessionId] } });
}

describe('window layout persistence namespaces', () => {
  it('keeps main keys unchanged and encodes actual standalone URL parameter ids', () => {
    expect(workspaceStorageKey('layout', '')).toBe('layout');
    expect(workspaceStorageKey('layout', '?projectId=p')).toBe('layout');
    expect(workspaceStorageKey('layout', '?sessionWindow=A')).toBe('layout:session:A');
    expect(workspaceStorageKey('layout', '?projectDashboard=P')).toBe('layout:dashboard:P');
    expect(workspaceStorageKey('layout', '?sessionWindow=a%3Ab%2Fc')).toBe('layout:session:a%3Ab%2Fc');
    expect(workspaceStorageKey('layout', '?projectDashboardWindow=P')).toBe('layout');
  });

  it('hydrates a session-window namespace before first write without reading or overwriting main layouts', async () => {
    const main = savedLayouts('main');
    const popup = savedLayouts('A');
    localStorage.setItem('claudia-right-workspace', main);
    localStorage.setItem('claudia-right-workspace:session:A', popup);
    setSearch('?sessionWindow=A&projectId=p');
    vi.resetModules();
    const { useRightWorkspaceStore } = await import('../rightWorkspaceStore');
    expect(useRightWorkspaceStore.persist.getOptions().name).toBe('claudia-right-workspace:session:A');
    expect(useRightWorkspaceStore.persist.hasHydrated()).toBe(true);
    expect(useRightWorkspaceStore.getState().bySession.A).toEqual(layout('A'));
    expect(useRightWorkspaceStore.getState().bySession.main).toBeUndefined();
    useRightWorkspaceStore.getState().openTool('A', 'memory');
    expect(localStorage.getItem('claudia-right-workspace')).toBe(main);
    expect(localStorage.getItem('claudia-right-workspace:session:A')).not.toBe(popup);
  });

  it('hydrates dashboard layout and project metadata independently from the main project anchor', async () => {
    const mainLayout = savedLayouts('main');
    const dashboardLayout = savedLayouts('dash');
    const mainMetadata = JSON.stringify({ version: 1, state: { byProject: {
      p: { workspaceId: 'main', focusedChatSessionId: 'main', toolBindings: {} },
    } } });
    const dashboardMetadata = JSON.stringify({ version: 1, state: { byProject: {
      p: { workspaceId: 'dash', focusedChatSessionId: 'dash', toolBindings: {} },
    } } });
    localStorage.setItem('claudia-right-workspace', mainLayout);
    localStorage.setItem('claudia-right-workspace:dashboard:p', dashboardLayout);
    localStorage.setItem('claudia-project-workspace', mainMetadata);
    localStorage.setItem('claudia-project-workspace:dashboard:p', dashboardMetadata);
    setSearch('?projectDashboard=p');
    vi.resetModules();
    const [{ useRightWorkspaceStore }, { useProjectWorkspaceStore }] = await Promise.all([
      import('../rightWorkspaceStore'), import('../projectWorkspaceStore'),
    ]);
    expect(useRightWorkspaceStore.getState().bySession.dash).toEqual(layout('dash'));
    expect(useProjectWorkspaceStore.getState().byProject.p.workspaceId).toBe('dash');
    useRightWorkspaceStore.getState().openTool('dash', 'memory');
    useProjectWorkspaceStore.getState().setFocusedChat('p', 'another-chat');
    expect(localStorage.getItem('claudia-right-workspace')).toBe(mainLayout);
    expect(localStorage.getItem('claudia-project-workspace')).toBe(mainMetadata);
    expect(useProjectWorkspaceStore.persist.getOptions().name).toBe('claudia-project-workspace:dashboard:p');
  });
});
