import {
  migrateSessionLayouts,
  resolveProjectWorkspace,
} from '../../actions/projectWorkspaceActions';
import { beforeEach, describe, expect, it } from 'vitest';
import { newPane, useRightWorkspaceStore, type LayoutNode } from '../rightWorkspaceStore';
import {
  resolveToolBindingSession,
  useProjectWorkspaceStore,
  workspaceRefKey,
} from '../projectWorkspaceStore';

beforeEach(() => {
  localStorage.clear();
  useProjectWorkspaceStore.setState({ byProject: {} });
  useRightWorkspaceStore.setState({ bySession: {}, order: [] });
});

function seed(sessionId: string, root: LayoutNode) {
  useRightWorkspaceStore.setState(state => ({
    bySession: {
      ...state.bySession,
      [sessionId]: { root, primaryPaneId: root.id, focusedPaneId: root.id },
    },
    order: [sessionId, ...state.order],
  }));
}

describe('project workspace compatibility migration', () => {
  it('adopts the MRU project session tree and preserves complete refs, ids, ratios and older layouts', () => {
    seed('A', newPane('memory'));
    const left = newPane('terminal', 'remote::worktreeA');
    const right = newPane('terminal', 'remote::worktreeB');
    const tree: LayoutNode = {
      id: 'saved-split',
      kind: 'group',
      dir: 'col',
      ratio: 0.63,
      children: [left, right],
    };
    seed('B', tree);
    seed('unrelated', newPane('draft'));
    const originalA = useRightWorkspaceStore.getState().bySession.A;
    expect(migrateSessionLayouts('project', ['A', 'B'], 'A')).toBe('B');
    const root = useRightWorkspaceStore.getState().bySession.B.root!;
    expect(root.kind).toBe('group');
    if (root.kind === 'group') expect(root.children[1]).toBe(tree);
    expect(useRightWorkspaceStore.getState().bySession.A).toBe(originalA);
    expect(resolveProjectWorkspace('project', ['A', 'B'], 'A')).toBe('B');
    expect(useRightWorkspaceStore.getState().bySession.B.root).toBe(root);
  });

  it('creates a chat anchor for a new project and keeps ownership separate across projects', () => {
    expect(resolveProjectWorkspace('projectA', ['A'], 'A')).toBe('A');
    expect(resolveProjectWorkspace('projectB', ['B'], 'B')).toBe('B');
    expect(useProjectWorkspaceStore.getState().byProject.projectA.focusedChatSessionId).toBe('A');
    expect(useProjectWorkspaceStore.getState().byProject.projectB.focusedChatSessionId).toBe('B');
  });

  it('never reseeds an anchor chat after the project switched to a different ref', () => {
    resolveProjectWorkspace('p', ['A'], 'A');
    const changed = newPane('chat', 'B');
    seed('A', changed);
    useProjectWorkspaceStore.getState().setFocusedChat('p', 'B');
    expect(resolveProjectWorkspace('p', ['A', 'B'], 'B')).toBe('A');
    expect(useRightWorkspaceStore.getState().bySession.A.root).toBe(changed);
  });

  it('restores project metadata and bindings through real persist hydration', async () => {
    resolveProjectWorkspace('p', ['A'], 'A');
    const terminal = { toolId: 'terminal', instanceKey: 'be::worktree' };
    useProjectWorkspaceStore
      .getState()
      .setToolBinding('p', terminal, { mode: 'fixed', sessionId: 'B' });
    const saved = localStorage.getItem('claudia-project-workspace')!;
    expect(JSON.parse(saved).version).toBe(1);
    useProjectWorkspaceStore.setState({ byProject: {} });
    localStorage.setItem('claudia-project-workspace', saved);
    await useProjectWorkspaceStore.persist.rehydrate();
    expect(useProjectWorkspaceStore.getState().byProject.p.workspaceId).toBe('A');
    expect(resolveToolBindingSession('p', terminal)).toBe('B');
  });

  it('hydrates v1 session-only storage before adopting it without deleting compatibility entries', async () => {
    const tree = newPane('terminal', 'be::scope');
    localStorage.setItem(
      'claudia-right-workspace',
      JSON.stringify({
        version: 1,
        state: {
          bySession: { A: { root: tree, focusedPaneId: tree.id, primaryPaneId: tree.id } },
          order: ['A'],
        },
      })
    );
    await useRightWorkspaceStore.persist.rehydrate();
    expect(resolveProjectWorkspace('p', ['A'], 'A')).toBe('A');
    expect(
      JSON.parse(localStorage.getItem('claudia-right-workspace')!).state.bySession.A
    ).toBeDefined();
    expect(useRightWorkspaceStore.getState().bySession.A.root?.kind).toBe('group');
  });

  it('filters malformed persisted ownership and binding metadata', async () => {
    localStorage.setItem(
      'claudia-project-workspace',
      JSON.stringify({
        version: 1,
        state: {
          byProject: {
            invalid: { workspaceId: 1, focusedChatSessionId: 'A' },
            p: {
              workspaceId: 'A',
              focusedChatSessionId: 'A',
              toolBindings: {
                '["terminal","scope"]': { mode: 'fixed', sessionId: 'B' },
                bad: { mode: 'fixed', sessionId: 5 },
              },
            },
          },
        },
      })
    );
    await useProjectWorkspaceStore.persist.rehydrate();
    expect(useProjectWorkspaceStore.getState().byProject.invalid).toBeUndefined();
    expect(useProjectWorkspaceStore.getState().byProject.p.toolBindings).toEqual({
      '["terminal","scope"]': { mode: 'fixed', sessionId: 'B' },
    });
  });
});

describe('tool chat bindings', () => {
  it('follows focused chat by default and fixes a complete content ref to a session', () => {
    resolveProjectWorkspace('p', ['A'], 'A');
    const a = { toolId: 'terminal', instanceKey: 'scopeA' };
    const b = { toolId: 'terminal', instanceKey: 'scopeB' };
    useProjectWorkspaceStore.getState().setToolBinding('p', a, { mode: 'fixed', sessionId: 'A' });
    useProjectWorkspaceStore.getState().setFocusedChat('p', 'B');
    expect(resolveToolBindingSession('p', a)).toBe('A');
    expect(resolveToolBindingSession('p', b)).toBe('B');
    useProjectWorkspaceStore.getState().setToolBinding('p', a, { mode: 'follow' });
    expect(resolveToolBindingSession('p', a)).toBe('B');
  });

  it('uses collision-free content identities and does not bind chat refs', () => {
    expect(workspaceRefKey({ toolId: 'a::b', instanceKey: 'c' })).not.toBe(
      workspaceRefKey({ toolId: 'a', instanceKey: 'b::c' })
    );
    resolveProjectWorkspace('p', ['A'], 'A');
    useProjectWorkspaceStore
      .getState()
      .setToolBinding('p', { toolId: 'chat', instanceKey: 'A' }, { mode: 'fixed', sessionId: 'B' });
    expect(useProjectWorkspaceStore.getState().byProject.p.toolBindings).toEqual({});
  });
});
