import { beforeEach, describe, expect, it } from 'vitest';
import { useRightWorkspaceStore, flattenPanes, isChatRef, normalizeSessionWorkspace } from '../rightWorkspaceStore';
import { useProjectWorkspaceStore } from '../projectWorkspaceStore';
import { useProjectStore } from '../projectStore';
import { useOwnershipStore } from '../ownershipStore';
import { forgetSession } from '../../services/session-ownership-coordination';
import { reconcileProjectChats, selectProjectChat, resolveProjectWorkspace } from '../../actions/projectWorkspaceActions';
import { sessionWorkspaceId } from '../workspaceRoutingStore';

const state = () => useRightWorkspaceStore.getState();
const root = () => state().bySession.A.root;
const refs = () => flattenPanes(root()).flatMap(p => p.tools);

beforeEach(() => {
  useRightWorkspaceStore.setState({ bySession: {}, order: [] });
  useProjectWorkspaceStore.setState({ byProject: {} });
  useOwnershipStore.setState({ sessionBackendIds: {}, sessionOwnershipVersions: {} });
  useProjectStore.setState({ sessions: ['A', 'B'].map(id => ({
    id, projectId: 'project', type: 'regular' as const, createdAt: 1, updatedAt: 1,
  })) });
});

describe('durable normalized workspace lifetime', () => {
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
  it('actual projectStore deletion preserves the adopted tree, then reconciliation removes only its deleted chat', () => {
    resolveProjectWorkspace('project', ['A', 'B'], 'A');
    selectProjectChat('project', 'B', { beside: true });
    state().openTool('A', 'terminal', { instanceKey: 'be::project', multiInstance: true });
    const before = state().bySession.A;
    const remainingChat = refs().find(ref => ref.instanceKey === 'B');
    const terminal = refs().find(ref => ref.toolId === 'terminal');
    useOwnershipStore.getState().setSessionOwners(['A', 'B'], 'be');
    useProjectStore.getState().deleteSession('A');
    expect(useOwnershipStore.getState().sessionBackendIds.A).toBeUndefined();
    expect(useOwnershipStore.getState().sessionBackendIds.B).toBe('be');
    expect(useProjectStore.getState().sessions.map(s => s.id)).toEqual(['B']);
    expect(state().bySession.A).toBe(before);
    expect(useProjectWorkspaceStore.getState().byProject.project.workspaceId).toBe('A');
    reconcileProjectChats('project', ['B'], 'B');
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
    expect(state().bySession.A).toBe(adopted);
    expect(state().bySession[scopedId]).toBeUndefined();
    expect(state().order).not.toContain(scopedId);
  });
});
