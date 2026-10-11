import { memo, useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJSONStorage } from 'zustand/middleware';
import {
  flattenPanes,
  newPane,
  useRightWorkspaceStore,
  type SessionWorkspace,
} from '../../../stores/rightWorkspaceStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionsStore } from '../../../stores/sessionsStore';
import { useOwnershipStore } from '../../../stores/ownershipStore';
import { useProjectWorkspaceStore } from '../../../stores/projectWorkspaceStore';
import { useRightSidebarStore } from '../../../stores/rightSidebarStore';
import { usePluginStore } from '../../../stores/pluginStore';
import { useUIStore } from '../../../stores/uiStore';
import {
  focusProjectChat,
  moveProjectChatToEdge,
  moveProjectChatToTab,
  openSessionTab,
  selectProjectChat,
} from '../../../actions/projectWorkspaceActions';
import { SessionWorkspaceView } from '../../../features/chat/SessionWorkspaceView';
import { sessionWorkspaceId, useWorkspaceRoutingStore } from '../../../stores/workspaceRoutingStore';
import { openToolInWorkspace } from '../../../actions/workspaceActions';
import { applyLayoutPreset } from '../../../actions/layoutPresetActions';
import { useDragSplitStore } from '../dragSplit';

const metrics = vi.hoisted(() => ({
  mounts: {} as Record<string, number>,
  unmounts: {} as Record<string, number>,
  renders: {} as Record<string, number>,
  subscriptions: {} as Record<string, number>,
  releases: {} as Record<string, number>,
  emit: {} as Record<string, (value: string) => void>,
  toolMounts: 0,
  toolUnmounts: 0,
}));

// Keep the real ChatPane and FlatWorkspaceView. Replace the network/large chat
// surface with independently stateful endpoints, so the test measures host identity.
vi.mock('../../../features/chat/ChatInterface', () => ({
  ChatInterface: memo(function TestChat({ sessionId, surface }: { sessionId: string; surface: string }) {
    const [draft, setDraft] = useState('');
    const [token, setToken] = useState('');
    useEffect(() => {
      metrics.emit[sessionId] = setToken;
    }, [sessionId]);
    useEffect(() => {
      metrics.renders[sessionId] = (metrics.renders[sessionId] ?? 0) + 1;
    });
    useEffect(() => {
      metrics.mounts[sessionId] = (metrics.mounts[sessionId] ?? 0) + 1;
      return () => { metrics.unmounts[sessionId] = (metrics.unmounts[sessionId] ?? 0) + 1; };
    }, [sessionId]);
    return <div data-chat-surface={surface}>
      <textarea aria-label={`Draft ${sessionId}`} value={draft} onChange={event => setDraft(event.target.value)} />
      <output aria-label={`Stream ${sessionId}`}>{token}</output>
    </div>;
  }),
}));
vi.mock('../../../features/chat/hooks/useSessionRoute', () => ({
  useSessionRoute: (sessionId: string, options: { maintainDesiredState: boolean }) => {
    useEffect(() => {
      if (!options.maintainDesiredState) return;
      metrics.subscriptions[sessionId] = (metrics.subscriptions[sessionId] ?? 0) + 1;
      return () => { metrics.releases[sessionId] = (metrics.releases[sessionId] ?? 0) + 1; };
    }, [sessionId, options.maintainDesiredState]);
  },
}));
vi.mock('../../../features/chat/hooks/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock('../../../hooks/useSelectionCoordinator', () => ({
  useSelectionCoordinator: () => ({ selectSession: (sessionId: string) => useProjectStore.setState({ selectedSessionId: sessionId }) }),
}));
vi.mock('../../RightSidebarEmptyState', () => ({ RightSidebarEmptyState: () => <div>Tool launcher</div> }));

function ToolEditor({ projectRoot }: { projectRoot?: string }) {
  const [value, setValue] = useState('');
  useEffect(() => {
    metrics.toolMounts++;
    return () => { metrics.toolUnmounts++; };
  }, []);
  return <label>Tool edit<input aria-label="Tool edit" value={value} onChange={event => setValue(event.target.value)} /><output aria-label="Tool root">{projectRoot}</output></label>;
}

const originalStorage = useRightWorkspaceStore.persist.getOptions().storage;

beforeEach(async () => {
  for (const map of [metrics.mounts, metrics.unmounts, metrics.renders, metrics.subscriptions, metrics.releases, metrics.emit]) {
    Object.keys(map).forEach(key => delete map[key]);
  }
  metrics.toolMounts = 0;
  metrics.toolUnmounts = 0;
  localStorage.clear();
  useRightWorkspaceStore.persist.setOptions({ storage: originalStorage });
  useRightWorkspaceStore.setState({ bySession: {}, order: [] });
  useProjectWorkspaceStore.setState({ byProject: {} });
  useWorkspaceRoutingStore.setState({ registrations: [], active: null });
  useRightSidebarStore.setState({ collapsed: false, widthFraction: 0.26 });
  useUIStore.setState({ poppedOutSessions: new Map() });
  useSessionsStore.getState().clearAllSessions();
  useOwnershipStore.setState({ projectBackendIds: {}, sessionBackendIds: {} });
  useProjectStore.setState({
    selectedProjectId: 'p', selectedSessionId: 'A',
    projects: [{ id: 'p', name: 'Project', type: 'code', rootPath: '/project', createdAt: 1, updatedAt: 1 }],
    sessions: ['A', 'B', 'C'].map(id => ({ id, projectId: 'p', name: id, type: 'regular', workingDirectory: `/worktree/${id}`, createdAt: 1, updatedAt: 1 })),
  });
  usePluginStore.setState({ panels: [{ id: 'memory', pluginId: 'test', type: 'panel', label: 'Memory', component: ToolEditor }] });
  for (const store of [useRightWorkspaceStore, useProjectWorkspaceStore, useRightSidebarStore]) await store.persist.rehydrate();
});

afterEach(() => {
  cleanup();
  useRightWorkspaceStore.persist.setOptions({ storage: originalStorage });
});

const view = (sessionId = 'A') => <SessionWorkspaceView sessionId={sessionId} projectId="p" projectRoot="/project" />;
const root = () => useRightWorkspaceStore.getState().bySession[useProjectWorkspaceStore.getState().byProject.p.workspaceId];
const chatPane = (id: string) => flattenPanes(root().root).find(p => p.tools.some(ref => ref.toolId === 'chat' && ref.instanceKey === id))!;

describe('SessionWorkspaceView project integration', () => {
  it('preserves restored chats when a partial REST catalog temporarily omits a session', () => {
    render(view());
    act(() => selectProjectChat('p', 'B', { beside: true }));
    const draft = screen.getByLabelText('Draft B');
    fireEvent.change(draft, { target: { value: 'persist B' } });
    act(() => useProjectStore.setState(state => ({ sessions: state.sessions.filter(s => s.id === 'A') })));
    expect(screen.getByLabelText('Draft B')).toBe(draft);
    expect(draft).toHaveValue('persist B');
    expect(metrics.unmounts.B).toBeUndefined();
  });

  it('reconciles an authoritative owner snapshot despite a stale REST catalog and preserves tools for an empty snapshot', () => {
    useOwnershipStore.getState().setProjectOwner('p', 'owner');
    render(view());
    act(() => {
      selectProjectChat('p', 'B', { beside: true });
      useRightWorkspaceStore.getState().openTool('A', 'memory');
      const tool = flattenPanes(root().root).flatMap(p => p.tools).find(t => t.toolId === 'memory')!;
      useProjectWorkspaceStore.getState().setToolBinding('p', tool, { mode: 'fixed', sessionId: 'B' });
    });
    const edit = screen.getByLabelText('Tool edit');
    const a = useProjectStore.getState().sessions.find(s => s.id === 'A')!;
    act(() => useSessionsStore.getState().setRemoteSessions('owner', [{ ...a, isActive: false }]));
    expect(screen.queryByLabelText('Draft B')).not.toBeInTheDocument();
    expect(metrics.releases.B).toBe(1);
    expect(Object.values(useProjectWorkspaceStore.getState().byProject.p.toolBindings)).toEqual([{ mode: 'follow' }]);
    act(() => useSessionsStore.getState().setRemoteSessions('owner', []));
    expect(screen.queryByLabelText('Draft A')).not.toBeInTheDocument();
    expect(metrics.releases.A).toBe(1);
    expect(screen.getByLabelText('Tool edit')).toBe(edit);
    expect(root().root).not.toBeNull();
    expect(useProjectStore.getState().sessions).toHaveLength(3);
  });

  it('keeps a newly created REST chat when first mounting against an older ready owner snapshot', () => {
    useOwnershipStore.getState().setProjectOwner('p', 'owner');
    const a = useProjectStore.getState().sessions.find(s => s.id === 'A')!;
    const b = useProjectStore.getState().sessions.find(s => s.id === 'B')!;
    useProjectStore.setState({ sessions: [a] });
    useSessionsStore.getState().setRemoteSessions('owner', [{ ...a, isActive: false }]);
    useProjectStore.getState().addSession(b);
    render(view('B'));
    expect(screen.getByLabelText('Draft B')).toBeInTheDocument();
    expect(useProjectWorkspaceStore.getState().byProject.p.focusedChatSessionId).toBe('B');
    expect(metrics.unmounts.B).toBeUndefined();
  });

  it('preserves a newly created chat across an in-flight old snapshot, then accepts confirmation and later deletion', () => {
    useOwnershipStore.getState().setProjectOwner('p', 'owner');
    const a = useProjectStore.getState().sessions.find(s => s.id === 'A')!;
    const b = useProjectStore.getState().sessions.find(s => s.id === 'B')!;
    useProjectStore.setState({ sessions: [a] });
    useSessionsStore.getState().setRemoteSessions('owner', [{ ...a, isActive: false }]);
    const { rerender } = render(view());
    act(() => useProjectStore.getState().addSession(b));
    rerender(view('B'));
    const draft = screen.getByLabelText('Draft B');
    fireEvent.change(draft, { target: { value: 'new draft' } });
    act(() => useSessionsStore.getState().handleSessionEvent('owner', 'created', { ...b, isActive: false }));
    act(() => useSessionsStore.getState().handleSessionEvent('owner', 'updated', { ...b, isActive: false, name: 'live updated' }));
    act(() => useSessionsStore.getState().setRemoteSessions('owner', [{ ...a, isActive: false }]));
    expect(screen.getByLabelText('Draft B')).toBe(draft);
    expect(draft).toHaveValue('new draft');
    act(() => useSessionsStore.getState().setRemoteSessions('owner', [{ ...a, isActive: false }, { ...b, isActive: false }]));
    expect(screen.getByLabelText('Draft B')).toBe(draft);
    act(() => useSessionsStore.getState().setRemoteSessions('owner', [{ ...a, isActive: false }]));
    expect(screen.queryByLabelText('Draft B')).not.toBeInTheDocument();
    expect(metrics.releases.B).toBe(1);
  });

  it('does not remount a deleted chat when the first late full snapshot still contains it', () => {
    useOwnershipStore.getState().setProjectOwner('p', 'owner');
    const a = useProjectStore.getState().sessions.find(s => s.id === 'A')!;
    const b = useProjectStore.getState().sessions.find(s => s.id === 'B')!;
    useSessionsStore.getState().setRemoteSessions('owner', [{ ...a, isActive: false }, { ...b, isActive: false }]);
    render(view());
    act(() => selectProjectChat('p', 'B', { beside: true }));
    const draftA = screen.getByLabelText('Draft A');
    act(() => useSessionsStore.getState().handleSessionEvent('owner', 'deleted', { ...b, isActive: false }));
    expect(screen.queryByLabelText('Draft B')).not.toBeInTheDocument();
    act(() => useSessionsStore.getState().setRemoteSessions('owner', [{ ...a, isActive: false }, { ...b, isActive: false }]));
    expect(screen.queryByLabelText('Draft B')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Draft A')).toBe(draftA);
    expect(metrics.mounts.B).toBe(1);
    expect(metrics.releases.B).toBe(1);
  });

  it('recovers from an authoritative empty workspace after REST creates a new chat', () => {
    useOwnershipStore.getState().setProjectOwner('p', 'owner');
    const b = useProjectStore.getState().sessions.find(s => s.id === 'B')!;
    const { rerender } = render(view());
    act(() => useRightWorkspaceStore.getState().openTool('A', 'memory'));
    const editor = screen.getByLabelText('Tool edit');
    act(() => useSessionsStore.getState().setRemoteSessions('owner', []));
    expect(screen.queryByLabelText('Draft A')).not.toBeInTheDocument();
    act(() => useProjectStore.getState().addSession(b));
    rerender(view('B'));
    expect(screen.getByLabelText('Draft B')).toBeInTheDocument();
    expect(screen.getByLabelText('Tool edit')).toBe(editor);
  });

  it('never reseeds an explicitly deleted chat from a stale REST catalog before the first full snapshot', () => {
    useOwnershipStore.getState().setProjectOwner('p', 'owner');
    const b = useProjectStore.getState().sessions.find(s => s.id === 'B')!;
    useProjectStore.getState().addSession(b);
    render(view('B'));
    expect(screen.getByLabelText('Draft B')).toBeInTheDocument();
    act(() => useSessionsStore.getState().handleSessionEvent('owner', 'deleted', { ...b, isActive: false }));
    expect(useProjectStore.getState().sessions.some(s => s.id === 'B')).toBe(true);
    expect(screen.queryByLabelText('Draft B')).not.toBeInTheDocument();
    expect(metrics.releases.B).toBe(1);
    expect(useSessionsStore.getState().snapshotBackendIds.has('owner')).toBe(false);
  });

  it('keeps dashboard chat focus and content when resizing the empty tool area', () => {
    render(<SessionWorkspaceView sessionId="A" projectId="p" syncSelection={false} />);
    act(() => selectProjectChat('p', 'B'));
    const draft = screen.getByLabelText('Draft B');
    fireEvent.change(draft, { target: { value: 'keep this draft' } });
    const layout = root().root;
    act(() => useRightSidebarStore.getState().setWidthFraction(0.4));
    expect(useProjectWorkspaceStore.getState().byProject.p.focusedChatSessionId).toBe('B');
    expect(root().root).toBe(layout);
    expect(screen.getByLabelText('Draft B')).toBe(draft);
    expect(draft).toHaveValue('keep this draft');
    expect(screen.queryByLabelText('Draft A')).not.toBeInTheDocument();
    expect(metrics.unmounts.B).toBeUndefined();
  });

  it('adopts the most recent project layout and uses one anchor across session selection and remount', () => {
    const tool = newPane('memory');
    useRightWorkspaceStore.setState({ bySession: {
      A: { root: null, primaryPaneId: null, focusedPaneId: null },
      B: { root: tool, primaryPaneId: tool.id, focusedPaneId: tool.id },
    }, order: ['B', 'A'] });
    const { rerender, unmount } = render(view());
    expect(useProjectWorkspaceStore.getState().byProject.p.workspaceId).toBe('B');
    expect(screen.getByLabelText('Draft A')).toBeVisible();
    const edit = screen.getByLabelText('Tool edit');
    fireEvent.change(edit, { target: { value: 'saved locally' } });
    act(() => selectProjectChat('p', 'C'));
    rerender(view('C'));
    expect(useProjectWorkspaceStore.getState().byProject.p.workspaceId).toBe('B');
    expect(screen.getByLabelText('Tool edit')).toBe(edit);
    expect(edit).toHaveValue('saved locally');
    expect(screen.getByLabelText('Tool root')).toHaveTextContent('/worktree/C');
    const layout = root().root;
    unmount();
    render(view('C'));
    expect(useProjectWorkspaceStore.getState().byProject.p.workspaceId).toBe('B');
    expect(root().root).toEqual(layout);
    expect(screen.getByLabelText('Draft C')).toBeVisible();
  });

  it('keeps independent chat state and subscriptions through tabs, movement, collapse and maximization', () => {
    render(view());
    act(() => {
      selectProjectChat('p', 'B', { beside: true });
      useRightWorkspaceStore.getState().openTool('A', 'memory');
    });
    const a = screen.getByLabelText('Draft A');
    const b = screen.getByLabelText('Draft B');
    const tool = screen.getByLabelText('Tool edit');
    fireEvent.change(a, { target: { value: 'draft A' } });
    fireEvent.change(b, { target: { value: 'draft B' } });
    fireEvent.change(tool, { target: { value: 'unsaved tool' } });
    const bRenders = metrics.renders.B;
    act(() => metrics.emit.A('A token'));
    expect(screen.getByLabelText('Stream A')).toHaveTextContent('A token');
    expect(screen.getByLabelText('Stream B')).toBeEmptyDOMElement();
    expect(metrics.renders.B).toBe(bRenders);
    act(() => moveProjectChatToTab('p', 'B', chatPane('A').id));
    expect(a.closest('[data-content-ref]')).not.toBeVisible();
    expect(b.closest('[data-content-ref]')).toBeVisible();
    act(() => focusProjectChat('p', 'A'));
    expect(a.closest('[data-content-ref]')).toBeVisible();
    act(() => moveProjectChatToEdge('p', 'B', 'bottom', chatPane('A').id));
    act(() => useRightSidebarStore.getState().setCollapsed(true));
    expect(tool.closest('[data-content-ref]')).not.toBeVisible();
    expect(a.closest('[data-content-ref]')).toBeVisible();
    expect(b.closest('[data-content-ref]')).toBeVisible();
    act(() => useRightSidebarStore.getState().setCollapsed(false));
    act(() => useRightWorkspaceStore.getState().setMaximizedPane('A', chatPane('B').id));
    expect(a.closest('[data-content-ref]')).not.toBeVisible();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(a.closest('[data-content-ref]')).toBeVisible();
    expect(screen.getByLabelText('Draft A')).toBe(a);
    expect(screen.getByLabelText('Draft B')).toBe(b);
    expect(a).toHaveValue('draft A');
    expect(b).toHaveValue('draft B');
    expect(tool).toHaveValue('unsaved tool');
    expect(metrics.mounts).toEqual({ A: 1, B: 1 });
    expect(metrics.unmounts).toEqual({});
    expect(metrics.subscriptions).toEqual({ A: 1, B: 1 });
    expect(metrics.releases).toEqual({});
    expect(metrics.toolMounts).toBe(1);
    expect(metrics.toolUnmounts).toBe(0);
  });

  it('commits a chat strip drop through the real pointer handler while preserving content hosts', () => {
    useProjectStore.setState(state => ({ sessions: [...state.sessions, {
      id: 'D', projectId: 'p', name: 'D', type: 'regular', createdAt: 1, updatedAt: 1,
    }] }));
    const { container } = render(view());
    act(() => {
      openSessionTab('p', 'B');
      selectProjectChat('p', 'C', { beside: true });
      openSessionTab('p', 'D', chatPane('C').id);
    });
    const b = screen.getByLabelText('Draft B');
    fireEvent.change(b, { target: { value: 'keep B' } });
    const target = chatPane('C');
    const strip = container.querySelector(`[data-tab-strip][data-pane-id="${target.id}"]`) as HTMLElement;
    const rect = (left: number, width: number) => ({ left, right: left + width, top: 20, bottom: 52,
      width, height: 32, x: left, y: 20, toJSON: () => ({}) }) as DOMRect;
    strip.getBoundingClientRect = () => rect(300, 300);
    strip.querySelectorAll<HTMLElement>('[data-tab-index]').forEach((tab, i) => {
      tab.getBoundingClientRect = () => rect(300 + i * 100, 100);
    });
    fireEvent.pointerDown(screen.getByRole('tab', { name: 'B' }), { pointerType: 'mouse', buttons: 1, clientX: 100, clientY: 30 });
    const wrapper = container.querySelector('[data-session-workspace]')!;
    fireEvent.pointerMove(wrapper, { pointerType: 'mouse', buttons: 1, clientX: 310, clientY: 30 });
    expect(useDragSplitStore.getState().hoverTabPaneId).toBe(target.id);
    fireEvent.pointerUp(wrapper, { pointerType: 'mouse', clientX: 310, clientY: 30 });
    expect(chatPane('B').id).toBe(target.id);
    expect(chatPane('B').tools.map(ref => ref.instanceKey)).toEqual(['B', 'C', 'D']);
    expect(chatPane('A').tools.map(ref => ref.instanceKey)).toEqual(['A']);
    expect(useDragSplitStore.getState().active).toBeNull();
    expect(screen.getByLabelText('Draft B')).toBe(b);
    expect(b).toHaveValue('keep B');
    expect(metrics.mounts.B).toBe(1);
    expect(metrics.subscriptions.B).toBe(1);
  });

  it('treats a press-release without travel as a click, not a split', () => {
    const { container } = render(view());
    act(() => openSessionTab('p', 'B'));
    expect(chatPane('A').tools.map(ref => ref.instanceKey)).toEqual(['A', 'B']);
    const wrapper = container.querySelector('[data-session-workspace]')!;
    const paneEl = container.querySelector(`[data-pane-id="${chatPane('A').id}"]`) as HTMLElement;
    paneEl.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const strip = container.querySelector(`[data-tab-strip][data-pane-id="${chatPane('A').id}"]`) as HTMLElement;
    strip.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 600, bottom: 32, width: 600, height: 32, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const before = root().root;
    // Payload mirrors WorkspaceChatControls' drag handle: no sourceIndex, origin
    // at the press point. SessionHeader (which hosts the handle) is mocked out here.
    act(() => useDragSplitStore.getState().startDrag(
      { toolId: 'chat', instanceKey: 'A', sourcePaneId: chatPane('A').id, multiInstance: true },
      { x: 30, y: 300 },
    ));
    expect(useDragSplitStore.getState().active).not.toBeNull();
    fireEvent.pointerUp(wrapper, { pointerType: 'mouse', clientX: 30, clientY: 300 });
    expect(root().root).toBe(before);
    expect(useDragSplitStore.getState().active).toBeNull();
    // A real drag from the same handle still splits the active chat out.
    act(() => useDragSplitStore.getState().startDrag(
      { toolId: 'chat', instanceKey: 'A', sourcePaneId: chatPane('A').id, multiInstance: true },
      { x: 30, y: 300 },
    ));
    fireEvent.pointerUp(wrapper, { pointerType: 'mouse', clientX: 300, clientY: 300 });
    expect(root().root).not.toBe(before);
    expect(chatPane('A').tools.map(ref => ref.instanceKey)).toEqual(['A']);
    expect(chatPane('B').tools.map(ref => ref.instanceKey)).toEqual(['B']);
  });

  it('cancels a real tab pointerdown released within the click threshold', () => {
    const { container } = render(view());
    act(() => openSessionTab('p', 'B'));
    const wrapper = container.querySelector('[data-session-workspace]')!;
    const strip = container.querySelector(`[data-tab-strip][data-pane-id="${chatPane('A').id}"]`) as HTMLElement;
    const rect = (left: number, width: number) =>
      ({ left, right: left + width, top: 0, bottom: 32, width, height: 32, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
    strip.getBoundingClientRect = () => rect(0, 600);
    strip.querySelectorAll<HTMLElement>('[data-tab-index]').forEach((tab, i) => {
      tab.getBoundingClientRect = () => rect(i * 300, 300);
    });
    const before = root().root;
    fireEvent.pointerDown(screen.getByRole('tab', { name: 'B' }), { pointerType: 'mouse', buttons: 1, clientX: 450, clientY: 16 });
    fireEvent.pointerUp(wrapper, { pointerType: 'mouse', clientX: 452, clientY: 17 });
    expect(root().root).toBe(before);
    expect(useDragSplitStore.getState().active).toBeNull();
  });

  it('clears tool maximization and an active drag when tools collapse', () => {
    render(view());
    act(() => useRightWorkspaceStore.getState().openTool('A', 'memory'));
    const pane = flattenPanes(root().root).find(p => p.tools[0].toolId === 'memory')!;
    act(() => {
      useRightWorkspaceStore.getState().setMaximizedPane('A', pane.id);
      useDragSplitStore.getState().startDrag({ toolId: 'memory', sourcePaneId: pane.id, sourceIndex: 0 });
    });
    expect(screen.getByLabelText('Draft A').closest('[data-content-ref]')).not.toBeVisible();
    act(() => useRightSidebarStore.getState().setCollapsed(true));
    expect(root().maximizedPaneId).toBeNull();
    expect(useDragSplitStore.getState().active).toBeNull();
    expect(screen.getByLabelText('Draft A').closest('[data-content-ref]')).toBeVisible();
  });

  it('moves a chat to the root gutter without nesting it at a pane edge', () => {
    const { container } = render(view());
    act(() => { selectProjectChat('p', 'B', { beside: true }); selectProjectChat('p', 'C', { beside: true }); });
    const wrapper = container.querySelector<HTMLElement>('[data-session-workspace]')!;
    wrapper.getBoundingClientRect = () => ({ left: 100, top: 100, width: 1000, height: 700, right: 1100, bottom: 800 }) as DOMRect;
    const source = chatPane('C');
    const c = screen.getByLabelText('Draft C');
    act(() => useDragSplitStore.getState().startDrag({ toolId: 'chat', instanceKey: 'C', sourcePaneId: source.id, sourceIndex: 0, multiInstance: true }));
    fireEvent.pointerMove(wrapper, { clientX: 600, clientY: 103, buttons: 1 });
    expect(container.querySelector('[data-root-drop="top"]')).not.toBeNull();
    const changes = vi.fn();
    const stop = useRightWorkspaceStore.subscribe(changes);
    fireEvent.pointerUp(wrapper, { clientX: 600, clientY: 103 });
    expect(changes).toHaveBeenCalledTimes(1);
    stop();
    const tree = root().root!;
    expect(tree.kind).toBe('group');
    if (tree.kind === 'group') {
      expect(tree.dir).toBe('col');
      expect(tree.children[0].id).toBe(source.id);
      expect(flattenPanes(tree.children[1]).flatMap(p => p.tools.map(ref => ref.instanceKey))).toEqual(['A', 'B']);
    }
    expect(screen.getByLabelText('Draft C')).toBe(c);
    expect(metrics.subscriptions.C).toBe(1);
    expect(useDragSplitStore.getState().active).toBeNull();
  });

  it('opens an unopened same-project catalog session at a root edge and rejects foreign sessions', () => {
    const { container } = render(view());
    const wrapper = container.querySelector<HTMLElement>('[data-session-workspace]')!;
    wrapper.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 700, right: 1000, bottom: 700 }) as DOMRect;
    act(() => useDragSplitStore.getState().startDrag({ toolId: 'chat', instanceKey: 'B', projectId: 'p', multiInstance: true }));
    fireEvent.pointerUp(wrapper, { clientX: 996, clientY: 300 });
    expect(screen.getByLabelText('Draft B')).toBeVisible();
    expect(useProjectStore.getState().selectedSessionId).toBe('B');
    const saved = root().root;
    act(() => useDragSplitStore.getState().startDrag({ toolId: 'chat', instanceKey: 'foreign', projectId: 'another', multiInstance: true }));
    fireEvent.pointerUp(wrapper, { clientX: 4, clientY: 300 });
    expect(root().root).toBe(saved);
    expect(useDragSplitStore.getState().active).toBeNull();
  });

  it('cancels an internal drag on pointer release outside the viewport and on pointercancel', () => {
    render(view());
    const source = chatPane('A');
    const payload = { toolId: 'chat', instanceKey: 'A', sourcePaneId: source.id, sourceIndex: 0, multiInstance: true };
    const saved = root().root;
    act(() => useDragSplitStore.getState().startDrag(payload));
    fireEvent.pointerUp(document.body, { clientX: -10, clientY: -10 });
    expect(useDragSplitStore.getState().active).toBeNull();
    act(() => useDragSplitStore.getState().startDrag(payload));
    fireEvent.pointerCancel(document);
    expect(useDragSplitStore.getState().active).toBeNull();
    expect(root().root).toBe(saved);
  });

  it('isolates a standalone session from a project anchor with the same real session id', () => {
    // Build a normal project layout before opening its A chat in a standalone surface.
    useRightWorkspaceStore.getState().ensureChatSession('A');
    useProjectWorkspaceStore.setState({ byProject: { p: { workspaceId: 'A', focusedChatSessionId: 'A', toolBindings: {} } } });
    selectProjectChat('p', 'B', { beside: true });
    useProjectStore.setState({ selectedSessionId: 'B' });
    const mainTree = root().root;
    const { unmount } = render(<SessionWorkspaceView sessionId="A" projectId="p" workspaceScope="session" syncSelection={false} />);
    expect(screen.getByLabelText('Draft A')).toBeVisible();
    expect(screen.queryByLabelText('Draft B')).toBeNull();
    const scopedId = sessionWorkspaceId('A');
    expect(useWorkspaceRoutingStore.getState().active?.workspaceId).toBe(scopedId);
    expect(useProjectWorkspaceStore.getState().byProject.p.focusedChatSessionId).toBe('B');
    act(() => openToolInWorkspace('A', 'memory', { projectId: 'p' }));
    expect(screen.getByLabelText('Tool root')).toHaveTextContent('/worktree/A');
    expect(flattenPanes(useRightWorkspaceStore.getState().bySession[scopedId].root)
      .flatMap(pane => pane.tools.map(ref => ref.toolId)).sort()).toEqual(['chat', 'memory']);
    fireEvent.pointerDown(screen.getByLabelText('Draft A'), { buttons: 1 });
    expect(useProjectStore.getState().selectedSessionId).toBe('B');
    expect(root().root).toBe(mainTree);
    expect(useProjectWorkspaceStore.getState().byProject.p.focusedChatSessionId).toBe('B');
    unmount();
    expect(useWorkspaceRoutingStore.getState().active).toBeNull();
  });

  it('keeps an embedded dashboard in place while local chat focus and tabs change', () => {
    render(<SessionWorkspaceView sessionId="A" projectId="p" syncSelection={false} />);
    act(() => selectProjectChat('p', 'B', { beside: true }));
    fireEvent.pointerDown(screen.getByLabelText('Draft B'), { buttons: 1 });
    expect(useProjectWorkspaceStore.getState().byProject.p.focusedChatSessionId).toBe('B');
    expect(useProjectStore.getState().selectedSessionId).toBe('A');
    act(() => moveProjectChatToTab('p', 'B', chatPane('A').id));
    fireEvent.click(screen.getByRole('tab', { name: 'A' }));
    expect(useProjectWorkspaceStore.getState().byProject.p.focusedChatSessionId).toBe('A');
    expect(useProjectStore.getState().selectedSessionId).toBe('A');
    fireEvent.click(screen.getByRole('tab', { name: 'B' }));
    expect(useProjectWorkspaceStore.getState().byProject.p.focusedChatSessionId).toBe('B');
    expect(useProjectStore.getState().selectedSessionId).toBe('A');
  });

  it('fills embedded preset placeholders without navigating the global selection', () => {
    render(<SessionWorkspaceView sessionId="A" projectId="p" syncSelection={false} />);
    act(() => applyLayoutPreset('p', 'compare'));
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(screen.getByLabelText('Draft B')).toBeVisible();
    expect(useProjectWorkspaceStore.getState().byProject.p.focusedChatSessionId).toBe('B');
    expect(useProjectStore.getState().selectedSessionId).toBe('A');
  });

  it('keeps chat maximization effective when the tools projection collapses', () => {
    render(view());
    act(() => selectProjectChat('p', 'B', { beside: true }));
    act(() => useRightWorkspaceStore.getState().setMaximizedPane('A', chatPane('B').id));
    act(() => useRightSidebarStore.getState().setCollapsed(true));
    expect(screen.getByLabelText('Draft A').closest('[data-content-ref]')).not.toBeVisible();
    expect(screen.getByLabelText('Draft B').closest('[data-content-ref]')).toBeVisible();
    expect(root().maximizedPaneId).toBe(chatPane('B').id);
  });

  it('waits for real persist hydration before normalizing a restored tree', async () => {
    let finishStorage: (saved: string | null) => void = () => {};
    const pending = new Promise<string | null>(resolve => { finishStorage = resolve; });
    useRightWorkspaceStore.persist.setOptions({ storage: createJSONStorage<{ bySession: Record<string, SessionWorkspace>; order: string[] }>(() => ({
      getItem: () => pending, setItem: () => {}, removeItem: () => {},
    })) });
    let hydration: Promise<void> | void;
    act(() => { hydration = useRightWorkspaceStore.persist.rehydrate(); });
    const tool = newPane('memory');
    const saved = JSON.stringify({ version: 1, state: { bySession: {
      A: { root: tool, primaryPaneId: tool.id, focusedPaneId: tool.id },
    }, order: ['A'] } });
    const { container } = render(view());
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByLabelText('Draft A')).toBeNull();
    expect(useProjectWorkspaceStore.getState().byProject.p).toBeUndefined();
    await act(async () => { finishStorage(saved); await hydration; });
    expect(screen.getByLabelText('Draft A')).toBeVisible();
    expect(screen.getByLabelText('Tool edit')).toBeVisible();
    expect(flattenPanes(root().root).find(p => p.id === tool.id)?.tools).toEqual(tool.tools);
    expect(metrics.subscriptions).toEqual({ A: 1 });
  });

});
