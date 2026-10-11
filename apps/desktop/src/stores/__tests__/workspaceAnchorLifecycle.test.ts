import { beforeEach, describe, expect, it } from 'vitest';
import { useRightWorkspaceStore, flattenPanes, isChatRef, normalizeSessionWorkspace, newPane } from '../rightWorkspaceStore';
import { useProjectWorkspaceStore } from '../projectWorkspaceStore';
import { useProjectStore } from '../projectStore';
import { useOwnershipStore } from '../ownershipStore';
import { forgetSession } from '../../services/session-ownership-coordination';
import { reconcileProjectChats, selectProjectChat, resolveProjectWorkspace } from '../../actions/projectWorkspaceActions';
import { sessionWorkspaceId } from '../workspaceRoutingStore';
import { useSessionsStore } from '../sessionsStore';
import { syncBackendDataEvent } from '../../facade/sync/backend-data-sync';
import { removeChatSession } from '../../utils/workspaceLayout';

const state = () => useRightWorkspaceStore.getState();
const root = () => state().bySession.A.root;
const refs = () => flattenPanes(root()).flatMap(p => p.tools);

beforeEach(() => {
  useRightWorkspaceStore.setState({ bySession: {}, order: [] });
  useProjectWorkspaceStore.setState({ byProject: {} });
  useSessionsStore.setState({ remoteSessions: new Map(), activeSessionIdsByBackend: new Map() });
  useOwnershipStore.setState({ sessionBackendIds: {}, sessionOwnershipVersions: {} });
  useProjectStore.setState({ sessions: ['A', 'B'].map(id => ({
    id, projectId: 'project', type: 'regular' as const, createdAt: 1, updatedAt: 1,
  })) });
});

describe('durable normalized workspace lifetime', () => {
  it('keeps an adopted tools-only anchor after all chats are deleted, cache churn and actual persistence reload', async () => {
    resolveProjectWorkspace('project', ['A', 'B'], 'A');
    state().openTool('A', 'memory');
    const memory = refs().find(ref => ref.toolId === 'memory');
    forgetSession('A');
    expect(state().bySession.A.durable).toBe(true);
    expect(refs()).toEqual([memory]);
    for (let index = 0; index < 60; index++) state().ensureSession(`legacy-${index}`);
    expect(refs()[0]).toBe(memory);
    const options = useRightWorkspaceStore.persist.getOptions();
    const persisted = localStorage.getItem(options.name);
    expect(persisted).toBeTruthy();
    useRightWorkspaceStore.setState({ bySession: {}, order: [] });
    localStorage.setItem(options.name, persisted!);
    await useRightWorkspaceStore.persist.rehydrate();
    expect(state().bySession.A.durable).toBe(true);
    expect(refs()).toEqual([memory]);
    for (let index = 0; index < 60; index++) state().ensureSession(`after-reload-${index}`);
    expect(state().bySession.A).toBeDefined();
    expect(refs()).toEqual([memory]);
    expect(Object.keys(state().bySession).filter(id => id !== 'A')).toHaveLength(50);
  });

  it('preserves the oldest adopted project tree while evicting only excess legacy layouts', () => {
    resolveProjectWorkspace('project', ['A', 'B'], 'A');
    selectProjectChat('project', 'B', { beside: true });
    state().openTool('A', 'memory');
    const adopted = state().bySession.A;
    for (let index = 0; index < 51; index++) state().ensureSession(`legacy-${index}`);
    expect(state().bySession.A).toBe(adopted);
    expect(state().order).toContain('A');
    expect(state().bySession['legacy-0']).toBeUndefined();
    expect(state().bySession['legacy-50']).toBeDefined();
    expect(Object.keys(state().bySession)).toHaveLength(51);
  });

  it('keeps more than fifty normalized trees and still bounds the separate legacy cache', () => {
    for (let index = 0; index < 60; index++) state().ensureChatSession(`durable-${index}`);
    expect(Object.keys(state().bySession)).toHaveLength(60);
    const original = state().bySession['durable-0'];
    for (let index = 0; index < 60; index++) state().openTool(`legacy-${index}`, 'memory');
    expect(state().bySession['durable-0']).toBe(original);
    expect(Object.keys(state().bySession).filter(id => id.startsWith('durable-'))).toHaveLength(60);
    expect(Object.keys(state().bySession).filter(id => id.startsWith('legacy-'))).toHaveLength(50);
    expect(state().order).toHaveLength(110);
    expect(state().bySession['legacy-9']).toBeUndefined();
    expect(state().bySession['legacy-10']).toBeDefined();
  });

  it('preserves a session entry once normalized after older tools-only cache creation', () => {
    state().openTool('A', 'memory');
    state().ensureChatSession('A');
    const normalized = state().bySession.A;
    for (let index = 0; index < 55; index++) state().ensureSession(`other-${index}`);
    expect(state().bySession.A).toBe(normalized);
  });
});

describe('deleted session ownership and adopted layout', () => {
  it('actual projectStore deletion immediately removes its chat while preserving the adopted anchor and other refs', () => {
    resolveProjectWorkspace('project', ['A', 'B'], 'A');
    selectProjectChat('project', 'B', { beside: true });
    state().openTool('A', 'terminal', { instanceKey: 'be::project', multiInstance: true });
    const remainingChat = refs().find(ref => ref.instanceKey === 'B');
    const terminal = refs().find(ref => ref.toolId === 'terminal');
    useOwnershipStore.getState().setSessionOwners(['A', 'B'], 'be');
    useProjectStore.getState().deleteSession('A');
    expect(useOwnershipStore.getState().sessionBackendIds.A).toBeUndefined();
    expect(useOwnershipStore.getState().sessionBackendIds.B).toBe('be');
    expect(useProjectStore.getState().sessions.map(s => s.id)).toEqual(['B']);
    expect(state().bySession.A).toBeDefined();
    expect(useProjectWorkspaceStore.getState().byProject.project.workspaceId).toBe('A');
    expect(refs().filter(isChatRef)).toEqual([remainingChat]);
    expect(refs().find(ref => ref.toolId === 'terminal')).toBe(terminal);
    expect(useProjectWorkspaceStore.getState().byProject.project.workspaceId).toBe('A');
  });

  it('preserves the anchor even when its original chat had already been replaced', () => {
    resolveProjectWorkspace('project', ['A', 'B'], 'A');
    selectProjectChat('project', 'B');
    state().openTool('A', 'memory');
    const before = state().bySession.A;
    forgetSession('A');
    expect(state().bySession.A).toBe(before);
    expect(refs().filter(isChatRef).map(ref => ref.instanceKey)).toEqual(['B']);
    expect(refs().some(ref => ref.toolId === 'memory')).toBe(true);
  });

  it('removes an ordinary legacy session layout and ownership when no project adopted it', () => {
    state().openTool('A', 'memory');
    useOwnershipStore.getState().setSessionOwner('A', 'be');
    forgetSession('A');
    expect(state().bySession.A).toBeUndefined();
    expect(state().order).not.toContain('A');
    expect(useOwnershipStore.getState().sessionBackendIds.A).toBeUndefined();
  });

  it('removes a non-anchor legacy entry without losing its sibling project chat or tools', () => {
    resolveProjectWorkspace('project', ['A', 'B'], 'A');
    selectProjectChat('project', 'B', { beside: true });
    state().openTool('A', 'memory');
    state().openTool('B', 'file-viewer');
    const memory = refs().find(ref => ref.toolId === 'memory');
    forgetSession('B');
    expect(state().bySession.B).toBeUndefined();
    expect(state().bySession.A).toBeDefined();
    reconcileProjectChats('project', ['A'], 'A');
    expect(refs().filter(isChatRef).map(ref => ref.instanceKey)).toEqual(['A']);
    expect(refs().find(ref => ref.toolId === 'memory')).toBe(memory);
  });

  it('cleans the deleted session standalone scope while retaining its adopted project anchor', () => {
    resolveProjectWorkspace('project', ['A', 'B'], 'A');
    selectProjectChat('project', 'B', { beside: true });
    const scopedId = sessionWorkspaceId('A');
    const standalone = normalizeSessionWorkspace({ root: null, primaryPaneId: null, focusedPaneId: null }, 'A');
    useRightWorkspaceStore.setState(s => ({ bySession: { ...s.bySession, [scopedId]: standalone }, order: [scopedId, ...s.order] }));
    const adopted = state().bySession.A;
    forgetSession('A');
    expect(state().bySession.A).toBeDefined();
    expect(state().bySession.A).not.toBe(adopted);
    expect(refs().filter(isChatRef).map(ref => ref.instanceKey)).toEqual(['B']);
    expect(state().bySession[scopedId]).toBeUndefined();
    expect(state().order).not.toContain(scopedId);
  });

  it('real remote delete removes the ref before the stale REST catalog refreshes and repairs pane metadata/bindings', () => {
    resolveProjectWorkspace('project', ['A', 'B'], 'A');
    selectProjectChat('project', 'B', { beside: true });
    selectProjectChat('project', 'A');
    state().openTool('A', 'terminal', { instanceKey: 'be::project', multiInstance: true });
    const paneA = flattenPanes(root()).find(pane => pane.tools.some(ref => ref.instanceKey === 'A'))!;
    state().focusPane('A', paneA.id);
    state().setMaximizedPane('A', paneA.id);
    const remainingChat = refs().find(ref => ref.instanceKey === 'B');
    const terminal = refs().find(ref => ref.toolId === 'terminal')!;
    useProjectWorkspaceStore.getState().setToolBinding('project', terminal, { mode: 'fixed', sessionId: 'A' });
    useSessionsStore.getState().setRemoteSessions('be', useProjectStore.getState().sessions.map(session => ({ ...session, isActive: true })));
    const deleted = useSessionsStore.getState().remoteSessions.get('be')!.find(session => session.id === 'A')!;
    useSessionsStore.getState().handleSessionEvent('be', 'deleted', deleted);
    expect(useProjectStore.getState().sessions.map(session => session.id)).toEqual(['A', 'B']);
    expect(useSessionsStore.getState().remoteSessions.get('be')!.map(session => session.id)).toEqual(['B']);
    expect(refs().filter(isChatRef)).toEqual([remainingChat]);
    expect(refs().find(ref => ref.toolId === 'terminal')).toBe(terminal);
    expect(state().bySession.A.maximizedPaneId).toBeNull();
    expect(state().bySession.A.focusedPaneId).not.toBe(paneA.id);
    expect(flattenPanes(root()).some(pane => pane.id === state().bySession.A.focusedPaneId)).toBe(true);
    expect(useProjectWorkspaceStore.getState().byProject.project).toMatchObject({
      workspaceId: 'A', focusedChatSessionId: 'B', toolBindings: { [JSON.stringify(['terminal', 'be::project'])]: { mode: 'follow' } },
    });
  });

  it('real facade archive removes even the last chat immediately while retaining tools and anchor', () => {
    resolveProjectWorkspace('project', ['A', 'B'], 'A');
    state().openTool('A', 'memory');
    const memory = refs().find(ref => ref.toolId === 'memory');
    useSessionsStore.getState().setRemoteSessions('be', [{ ...useProjectStore.getState().sessions[0], isActive: true }]);
    syncBackendDataEvent({ type: 'backend_data_event', backendId: 'be', event: {
      resourceType: 'session', op: 'upsert', resourceId: 'A', resource: {
        sessionId: 'A', projectId: 'project', createdAt: 1, updatedAt: 2, runStatus: 'idle', archived: true,
      },
    } } as any);
    expect(useProjectStore.getState().sessions.map(session => session.id)).toEqual(['A', 'B']);
    expect(refs().filter(isChatRef)).toEqual([]);
    expect(refs()).toEqual([memory]);
    expect(useSessionsStore.getState().remoteSessions.get('be')).toEqual([]);
    expect(useProjectWorkspaceStore.getState().byProject.project).toMatchObject({ workspaceId: 'A', focusedChatSessionId: '' });
  });

  it('keeps an empty adopted anchor after a real final-chat delete and removes matching refs from every project tree', () => {
    resolveProjectWorkspace('project', ['A', 'B'], 'A');
    const otherChat = newPane('chat', 'other-chat');
    const sharedDeleted = newPane('chat', 'A');
    const otherRoot = { id: 'other-group', kind: 'group' as const, dir: 'row' as const, ratio: 0.6, children: [sharedDeleted, otherChat] as [typeof sharedDeleted, typeof otherChat] };
    useRightWorkspaceStore.setState(s => ({ bySession: { ...s.bySession, other: { root: otherRoot, primaryPaneId: null, focusedPaneId: sharedDeleted.id } } }));
    useProjectWorkspaceStore.setState(s => ({ byProject: { ...s.byProject, other: { workspaceId: 'other', focusedChatSessionId: 'A', toolBindings: {} } } }));
    useSessionsStore.getState().handleSessionEvent('be', 'deleted', { ...useProjectStore.getState().sessions[0], isActive: false });
    expect(state().bySession.A).toMatchObject({ root: null, primaryPaneId: null, focusedPaneId: null });
    expect(state().bySession.other.root).toBe(otherChat);
    expect(useProjectWorkspaceStore.getState().byProject.other.focusedChatSessionId).toBe('other-chat');
  });

  it('pure removal repairs the active chat tab and preserves surviving ref/placeholder identity', () => {
    const a = { toolId: 'chat', instanceKey: 'A' };
    const b = { toolId: 'chat', instanceKey: 'B' };
    const pane = { ...newPane('chat', 'A'), tools: [a, b] };
    const slot = { id: 'slot', kind: 'placeholder' as const, slotId: 'slot', accepts: 'chat' as const };
    const original = { id: 'group', kind: 'group' as const, dir: 'row' as const, ratio: 0.7, children: [pane, slot] as [typeof pane, typeof slot] };
    const next = removeChatSession(original, 'A');
    expect(next?.kind).toBe('group');
    expect(flattenPanes(next)[0]).toMatchObject({ id: pane.id, activeToolId: 'chat', activeInstanceKey: 'B', tools: [b] });
    expect(flattenPanes(next)[0].tools[0]).toBe(b);
    if (next?.kind === 'group') expect(next.children[1]).toBe(slot);
    expect(removeChatSession(next, 'absent')).toBe(next);
  });
});
