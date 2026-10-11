import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activeToolRef, findPane, flattenPanes, normalizeSessionWorkspace, useRightWorkspaceStore } from '../../stores/rightWorkspaceStore';
import { useProjectStore } from '../../stores/projectStore';
import { sessionWorkspaceId } from '../../stores/workspaceRoutingStore';
import { resolveToolBindingSession, useProjectWorkspaceStore } from '../../stores/projectWorkspaceStore';
import { closeChatRef, focusProjectChat, moveScopedChatToEdge, moveProjectChatToEdge, moveProjectChatToTab, openSessionTab, reconcileProjectChats, selectProjectChat, resolveProjectWorkspace } from '../projectWorkspaceActions';

beforeEach(() => {
  useProjectWorkspaceStore.setState({ byProject: {} });
  useRightWorkspaceStore.setState({ bySession: {}, order: [] });
  resolveProjectWorkspace('p', ['A'], 'A');
});
const workspace = () => useRightWorkspaceStore.getState().bySession.A;
const sessions = () => flattenPanes(workspace().root).flatMap(p => p.tools.filter(t => t.toolId === 'chat').map(t => t.instanceKey));
const paneFor = (sessionId: string) => flattenPanes(workspace().root).find(p => p.tools.some(t => t.toolId === 'chat' && t.instanceKey === sessionId))!;

describe('project chat selection', () => {
  it('plain selection replaces the focused ref, preserving its shell and project anchor', () => {
    const id = paneFor('A').id;
    expect(selectProjectChat('p', 'B')).toEqual({ ok: true, paneId: id });
    expect(sessions()).toEqual(['B']);
    expect(useProjectWorkspaceStore.getState().byProject.p.workspaceId).toBe('A');
    expect(useProjectWorkspaceStore.getState().byProject.p.focusedChatSessionId).toBe('B');
  });

  it('modifier selection opens beside and existing selection focuses without duplication', () => {
    selectProjectChat('p', 'B', { beside: true });
    const root = workspace().root!;
    expect(root.kind).toBe('group');
    expect(sessions()).toEqual(['A', 'B']);
    expect(selectProjectChat('p', 'A', { beside: true })).toEqual({ ok: true, paneId: paneFor('A').id });
    expect(sessions()).toEqual(['A', 'B']);
    expect(workspace().focusedPaneId).toBe(paneFor('A').id);
  });

  it('remembers chat focus when a tool pane receives focus, then replaces that chat', () => {
    selectProjectChat('p', 'B', { beside: true });
    focusProjectChat('p', 'A');
    useRightWorkspaceStore.getState().openTool('A', 'terminal', { instanceKey: 'be::p', multiInstance: true });
    const toolRoot = workspace().root;
    const tool = flattenPanes(toolRoot).find(p => p.tools.some(t => t.toolId === 'terminal'))!;
    useRightWorkspaceStore.getState().focusPane('A', tool.id);
    selectProjectChat('p', 'C');
    expect(sessions()).toEqual(['C', 'B']);
    expect(flattenPanes(workspace().root).find(p => p.id === tool.id)?.tools)
      .toEqual([{ toolId: 'terminal', instanceKey: 'be::p' }]);
  });

  it('opens session tabs and activates an existing inactive ref without adding duplicates', () => {
    const id = paneFor('A').id;
    openSessionTab('p', 'B');
    openSessionTab('p', 'C');
    expect(sessions()).toEqual(['A', 'B', 'C']);
    expect(flattenPanes(workspace().root)).toHaveLength(1);
    expect(activeToolRef(paneFor('C')).instanceKey).toBe('C');
    openSessionTab('p', 'A');
    expect(sessions()).toEqual(['A', 'B', 'C']);
    expect(workspace().focusedPaneId).toBe(id);
    expect(activeToolRef(paneFor('A')).instanceKey).toBe('A');
  });

  it('replaces only the active tab and preserves all inactive complete refs', () => {
    openSessionTab('p', 'B');
    openSessionTab('p', 'C');
    focusProjectChat('p', 'B');
    const inactiveA = paneFor('A').tools[0];
    selectProjectChat('p', 'D');
    expect(sessions()).toEqual(['A', 'D', 'C']);
    expect(paneFor('A').tools[0]).toBe(inactiveA);
  });

  it('selecting a hidden chat clears incompatible maximization so it becomes visible', () => {
    selectProjectChat('p', 'B', { beside: true });
    useRightWorkspaceStore.getState().setMaximizedPane('A', paneFor('B').id);
    focusProjectChat('p', 'A');
    expect(workspace().maximizedPaneId).toBeNull();
  });
});

describe('chat closing and moving', () => {
  it('rejects closing the final chat and closes an inactive tab without losing the focused ref', () => {
    expect(closeChatRef('p', 'A')).toEqual({ ok: false });
    openSessionTab('p', 'B');
    closeChatRef('p', 'A');
    expect(sessions()).toEqual(['B']);
    expect(useProjectWorkspaceStore.getState().byProject.p.focusedChatSessionId).toBe('B');
    expect(closeChatRef('p', 'B')).toEqual({ ok: false });
  });

  it('collapses a closed pane and repairs focus and maximize state', () => {
    selectProjectChat('p', 'B', { beside: true });
    useRightWorkspaceStore.getState().setMaximizedPane('A', paneFor('B').id);
    closeChatRef('p', 'B');
    expect(sessions()).toEqual(['A']);
    expect(workspace().root?.kind).toBe('pane');
    expect(workspace().focusedPaneId).toBe(paneFor('A').id);
    expect(workspace().maximizedPaneId).toBeNull();
  });

  it('moves a chat to all root edges atomically, preserving shell and content ref identities', () => {
    selectProjectChat('p', 'B', { beside: true });
    const b = paneFor('B');
    const changes = vi.fn();
    const unsubscribe = useRightWorkspaceStore.subscribe(changes);
    for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
      changes.mockClear();
      expect(moveProjectChatToEdge('p', 'B', edge).ok).toBe(true);
      expect(changes).toHaveBeenCalledTimes(1);
      expect(paneFor('B')).toBe(b);
      expect(paneFor('B').tools[0]).toBe(b.tools[0]);
      expect(sessions().sort()).toEqual(['A', 'B']);
    }
    unsubscribe();
  });

  it('splits an existing session tab at its own pane edge without recreating its ref', () => {
    openSessionTab('p', 'B');
    const source = paneFor('B');
    const ref = source.tools[1];
    const result = moveProjectChatToEdge('p', 'B', 'right', source.id);
    expect(result.ok).toBe(true);
    expect(paneFor('A').id).toBe(source.id);
    expect(paneFor('B').id).not.toBe(source.id);
    expect(paneFor('B').tools[0]).toBe(ref);
    expect(sessions()).toEqual(['A', 'B']);
  });

  it('rejects invalid destinations and a single-chat self split without any state notification', () => {
    const before = workspace();
    const changes = vi.fn();
    const unsubscribe = useRightWorkspaceStore.subscribe(changes);
    expect(moveProjectChatToEdge('p', 'A', 'left', 'missing').ok).toBe(false);
    expect(moveProjectChatToEdge('p', 'A', 'left', paneFor('A').id).ok).toBe(false);
    expect(workspace()).toBe(before);
    expect(changes).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('preserves fixed worktree bindings when chats move, close their pane, or become tabs', () => {
    selectProjectChat('p', 'B', { beside: true });
    const tool = { toolId: 'terminal', instanceKey: 'be::worktreeB' };
    useProjectWorkspaceStore.getState().setToolBinding('p', tool, { mode: 'fixed', sessionId: 'B' });
    moveProjectChatToEdge('p', 'B', 'bottom');
    closeChatRef('p', 'B');
    expect(resolveToolBindingSession('p', tool)).toBe('B');
    openSessionTab('p', 'B');
    expect(resolveToolBindingSession('p', tool)).toBe('B');
    expect(findPane(workspace().root, paneFor('A').id)?.tools).toHaveLength(2);
  });
});


describe('project catalog reconciliation', () => {
  it('removes deleted chat refs, preserves tools and repairs deleted fixed bindings', () => {
    selectProjectChat('p', 'B', { beside: true });
    useRightWorkspaceStore.getState().openTool('A', 'terminal', { instanceKey: 'scope', multiInstance: true });
    const tool = { toolId: 'terminal', instanceKey: 'scope' };
    const original = flattenPanes(workspace().root).find(p => p.tools.some(t => t.toolId === 'terminal'))!;
    useProjectWorkspaceStore.getState().setToolBinding('p', tool, { mode: 'fixed', sessionId: 'B' });
    reconcileProjectChats('p', ['A'], 'A');
    expect(sessions()).toEqual(['A']);
    expect(flattenPanes(workspace().root).find(p => p.id === original.id)).toBe(original);
    expect(resolveToolBindingSession('p', tool)).toBe('A');
    expect(useProjectWorkspaceStore.getState().byProject.p.focusedChatSessionId).toBe('A');
  });

  it('reseeds from a real surviving catalog session when every displayed chat was deleted', () => {
    const id = useProjectWorkspaceStore.getState().byProject.p.workspaceId;
    reconcileProjectChats('p', ['B', 'C'], 'C');
    expect(sessions()).toEqual(['C']);
    expect(useProjectWorkspaceStore.getState().byProject.p.workspaceId).toBe(id);
    expect(workspace().focusedPaneId).toBe(paneFor('C').id);
  });

  it('leaves empty/loading catalogs untouched and is idempotent with valid chats', () => {
    const before = workspace();
    const changed = vi.fn();
    const unsubscribe = useRightWorkspaceStore.subscribe(changed);
    expect(reconcileProjectChats('p', []).ok).toBe(false);
    expect(reconcileProjectChats('p', ['A']).ok).toBe(true);
    expect(workspace()).toBe(before);
    expect(changed).not.toHaveBeenCalled();
    unsubscribe();
  });
});


describe('chat strip moves', () => {
  it('merges panes into session tabs in one layout update with the original ref', () => {
    selectProjectChat('p', 'B', { beside: true });
    const a = paneFor('A');
    const b = paneFor('B');
    const ref = b.tools[0];
    useRightWorkspaceStore.getState().setMaximizedPane('A', b.id);
    const changed = vi.fn();
    const unsubscribe = useRightWorkspaceStore.subscribe(changed);
    expect(moveProjectChatToTab('p', 'B', a.id, 0)).toEqual({ ok: true, paneId: a.id });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(flattenPanes(workspace().root)).toHaveLength(1);
    expect(paneFor('B').tools[0]).toBe(ref);
    expect(sessions()).toEqual(['B', 'A']);
    expect(workspace().focusedPaneId).toBe(a.id);
    expect(workspace().maximizedPaneId).toBeNull();
    unsubscribe();
  });

  it('reorders within a session strip using insertion slots before source removal', () => {
    openSessionTab('p', 'B');
    openSessionTab('p', 'C');
    const source = paneFor('A');
    const refs = [...source.tools];
    moveProjectChatToTab('p', 'A', source.id, 3);
    expect(sessions()).toEqual(['B', 'C', 'A']);
    expect(paneFor('A').tools[2]).toBe(refs[0]);
    moveProjectChatToTab('p', 'C', source.id, 0);
    expect(sessions()).toEqual(['C', 'B', 'A']);
    expect(paneFor('C').tools[0]).toBe(refs[2]);
  });

  it('preserves other source tabs when moving only one session between strips', () => {
    openSessionTab('p', 'B');
    selectProjectChat('p', 'C', { beside: true });
    const sourceId = paneFor('A').id;
    const targetId = paneFor('C').id;
    moveProjectChatToTab('p', 'B', targetId);
    expect(paneFor('A').id).toBe(sourceId);
    expect(paneFor('A').tools).toHaveLength(1);
    expect(paneFor('B').id).toBe(targetId);
    expect(paneFor('B').tools.map(t => t.instanceKey)).toEqual(['C', 'B']);
    expect(sessions().sort()).toEqual(['A', 'B', 'C']);
  });

  it('rejects tools, vanished targets and invalid sessions without changing the layout', () => {
    useRightWorkspaceStore.getState().openTool('A', 'memory');
    const tool = flattenPanes(workspace().root).find(p => p.tools[0].toolId === 'memory')!;
    const before = workspace();
    const changed = vi.fn();
    const unsubscribe = useRightWorkspaceStore.subscribe(changed);
    expect(moveProjectChatToTab('p', 'A', tool.id).ok).toBe(false);
    expect(moveProjectChatToTab('p', 'A', 'missing').ok).toBe(false);
    expect(moveProjectChatToTab('p', 'deleted', paneFor('A').id).ok).toBe(false);
    expect(workspace()).toBe(before);
    expect(changed).not.toHaveBeenCalled();
    unsubscribe();
  });
});


describe('catalog and standalone chat edge moves', () => {
  it('opens only real same-project unarchived catalog sessions', () => {
    useProjectStore.setState({ sessions: [
      { id: 'B', projectId: 'p', type: 'regular', createdAt: 1, updatedAt: 1 },
      { id: 'C', projectId: 'p', type: 'regular', archivedAt: 1, createdAt: 1, updatedAt: 1 },
      { id: 'foreign', projectId: 'other', type: 'regular', createdAt: 1, updatedAt: 1 },
    ] });
    const before = workspace();
    expect(moveProjectChatToEdge('p', 'missing', 'right').ok).toBe(false);
    expect(moveProjectChatToEdge('p', 'foreign', 'right').ok).toBe(false);
    expect(moveProjectChatToEdge('p', 'C', 'right').ok).toBe(false);
    expect(workspace()).toBe(before);
    expect(moveProjectChatToEdge('p', 'B', 'right').ok).toBe(true);
    expect(sessions()).toEqual(['A', 'B']);
  });

  it('moves a standalone real chat under its synthetic key without changing project metadata', () => {
    const scopedId = sessionWorkspaceId('A');
    const state = useRightWorkspaceStore.getState();
    const scoped = normalizeSessionWorkspace({ root: null, primaryPaneId: null, focusedPaneId: null }, 'A');
    const chat = flattenPanes(scoped.root)[0];
    useRightWorkspaceStore.setState(s => ({ bySession: { ...s.bySession, [scopedId]: scoped } }));
    state.openTool(scopedId, 'memory');
    const oldProject = useProjectWorkspaceStore.getState().byProject.p;
    expect(moveScopedChatToEdge(scopedId, 'A', 'bottom').ok).toBe(true);
    const tree = useRightWorkspaceStore.getState().bySession[scopedId].root!;
    expect(tree.kind).toBe('group');
    if (tree.kind === 'group') {
      expect(tree.dir).toBe('col');
      expect(tree.children[1].id).toBe(chat.id);
    }
    expect(useProjectWorkspaceStore.getState().byProject.p).toBe(oldProject);
    expect(sessions()).toEqual(['A']);
  });
});
