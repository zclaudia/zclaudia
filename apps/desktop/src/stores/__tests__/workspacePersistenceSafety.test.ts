import { beforeEach, describe, expect, it } from 'vitest';
import {
  flattenPanes,
  isSafeTree,
  newPane,
  useRightWorkspaceStore,
  type LayoutNode,
} from '../rightWorkspaceStore';
import {
  BUILTIN_LAYOUT_PRESETS,
  isSafePresetTree,
  mapLayoutPreset,
  useLayoutPresetStore,
} from '../layoutPresetStore';
import { useProjectWorkspaceStore, workspaceRefKey } from '../projectWorkspaceStore';
import { useRightSidebarStore } from '../rightSidebarStore';

beforeEach(() => {
  localStorage.clear();
  useRightWorkspaceStore.setState({ bySession: {}, order: [] });
  useProjectWorkspaceStore.setState({ byProject: {} });
});

function split(a: unknown, b: unknown) {
  return { id: 'group', kind: 'group', dir: 'row', ratio: 0.6, children: [a, b] };
}

async function hydrate(root: unknown, version = 3) {
  localStorage.setItem(
    'claudia-right-workspace',
    JSON.stringify({
      version,
      state: {
        bySession: { A: { root, focusedPaneId: 'gone', primaryPaneId: 'gone' } },
        order: ['A'],
      },
    })
  );
  await useRightWorkspaceStore.persist.rehydrate();
  return useRightWorkspaceStore.getState().bySession.A;
}

describe('persisted workspace corruption recovery', () => {
  it('recovers a valid chat sibling when the other persisted leaf is malformed', async () => {
    const chat = newPane('chat', 'A');
    const ws = await hydrate(split(chat, { kind: 'pane', id: 'broken', tools: null }), 2);
    expect(ws.root).toEqual(chat);
    expect(ws.focusedPaneId).toBe(chat.id);
    expect(JSON.parse(localStorage.getItem('claudia-right-workspace')!).version).toBe(3);
  });

  it('repairs stale active tabs without losing valid refs or accepting malformed instance keys', async () => {
    const root = {
      id: 'tools',
      kind: 'pane',
      tools: [
        { toolId: 'terminal', instanceKey: 'scope' },
        { toolId: 'memory' },
        { toolId: 'terminal', instanceKey: { invalid: true } },
      ],
      activeToolId: 'missing',
      activeInstanceKey: 'missing',
    };
    const ws = await hydrate(root);
    expect(ws.root).toMatchObject({
      id: 'tools',
      activeToolId: 'terminal',
      activeInstanceKey: 'scope',
      tools: [{ toolId: 'terminal', instanceKey: 'scope' }, { toolId: 'memory' }],
    });
    expect(isSafeTree(ws.root)).toBe(true);
  });

  it('repairs duplicate IDs and refs while retaining distinct terminal scopes', async () => {
    const a = { ...newPane('terminal', 'scope-a'), id: 'same' };
    const b = {
      ...newPane('terminal', 'scope-b'),
      id: 'same',
      tools: [
        { toolId: 'terminal', instanceKey: 'scope-b' },
        { toolId: 'terminal', instanceKey: 'scope-a' },
      ],
    };
    expect(isSafeTree(split(a, b))).toBe(false);
    const ws = await hydrate(split(a, b));
    const panes = flattenPanes(ws.root);
    expect(new Set(panes.map(p => p.id)).size).toBe(2);
    expect(panes.flatMap(p => p.tools)).toEqual([
      { toolId: 'terminal', instanceKey: 'scope-a' },
      { toolId: 'terminal', instanceKey: 'scope-b' },
    ]);
    expect(isSafeTree(ws.root)).toBe(true);
  });

  it('splits an invalid mixed chat/tool pane so ordinary tool actions cannot discard chat', async () => {
    const ws = await hydrate({
      id: 'mixed',
      kind: 'pane',
      tools: [{ toolId: 'chat', instanceKey: 'A' }, { toolId: 'memory' }],
      activeToolId: 'chat',
      activeInstanceKey: 'A',
    });
    const panes = flattenPanes(ws.root);
    expect(panes).toHaveLength(2);
    const tools = panes.find(p => p.tools[0].toolId === 'memory')!;
    useRightWorkspaceStore.getState().closePane('A', tools.id);
    expect(
      flattenPanes(useRightWorkspaceStore.getState().bySession.A.root).flatMap(p => p.tools)
    ).toEqual([{ toolId: 'chat', instanceKey: 'A' }]);
  });

  it('normalizes nonfinite runtime ratios without corrupting a persisted valid layout', () => {
    const root = split(newPane('chat', 'A'), newPane('memory')) as LayoutNode;
    useRightWorkspaceStore.setState({
      bySession: { A: { root, focusedPaneId: null, primaryPaneId: null } },
    });
    useRightWorkspaceStore.getState().setRatio('A', 'group', NaN);
    expect(isSafeTree(useRightWorkspaceStore.getState().bySession.A.root)).toBe(true);
  });

  it('reactivates a singleton using its actual persisted ref rather than a different requested key', () => {
    useRightWorkspaceStore.getState().openTool('A', 'memory', { instanceKey: 'saved-scope' });
    const before = flattenPanes(useRightWorkspaceStore.getState().bySession.A.root)[0].tools[0];
    useRightWorkspaceStore.getState().openTool('A', 'memory', { instanceKey: 'other-scope' });
    const ws = useRightWorkspaceStore.getState().bySession.A;
    expect(isSafeTree(ws.root)).toBe(true);
    expect(flattenPanes(ws.root)[0].tools).toEqual([before]);
    expect(flattenPanes(ws.root)[0].activeInstanceKey).toBe('saved-scope');
  });

  it('strictly validates exact active refs, chat identities and placeholder slot kinds', () => {
    expect(isSafeTree({ ...newPane('terminal', 'scope'), activeInstanceKey: 'other' })).toBe(false);
    expect(isSafeTree(newPane('chat'))).toBe(false);
    expect(
      isSafeTree({ id: 'empty', kind: 'placeholder', slotId: 'slot', accepts: 'tool:chat' })
    ).toBe(false);
    expect(
      isSafePresetTree({
        kind: 'slots',
        slotId: 'pane',
        slots: [{ slotId: 'slot', kind: 'tool:chat' }],
      })
    ).toBe(false);
  });

  it('rejects cyclic validator inputs without overflowing the stack', () => {
    const cycle = split(newPane('memory'), null);
    cycle.children[1] = cycle;
    expect(isSafeTree(cycle)).toBe(false);
  });

  it('keeps singletons unique while salvaging valid scope refs and duplicate placeholder identities', async () => {
    const tools = {
      ...newPane('memory'),
      tools: [{ toolId: 'memory' }, { toolId: 'memory', instanceKey: 'bad-scope' }],
    };
    const empty = { id: 'empty', kind: 'placeholder', slotId: 'slot', accepts: 'chat' };
    const ws = await hydrate(
      split(tools, { ...split(empty, { ...empty, id: 'empty-2' }), id: 'inner' })
    );
    expect(flattenPanes(ws.root).flatMap(p => p.tools)).toEqual([{ toolId: 'memory' }]);
    expect(isSafeTree(ws.root)).toBe(true);
  });

  it('avoids collisions between retained pane ids and generated preset group ids', () => {
    const layout = BUILTIN_LAYOUT_PRESETS.find(p => p.id === 'compare')!;
    const pane = { ...newPane('chat', 'A'), id: 'preset-group-compare-compare-root' };
    const next = mapLayoutPreset(
      { root: pane, primaryPaneId: null, focusedPaneId: pane.id },
      layout,
      'A'
    );
    expect(isSafeTree(next.root)).toBe(true);
    expect(flattenPanes(next.root).flatMap(p => p.tools)).toEqual(pane.tools);
    expect(mapLayoutPreset(next, layout, 'A')).toBe(next);
  });

  it('finishes hydration after malformed JSON, backing up the original bytes before later writes', async () => {
    const corrupt = '{"version":3,"state":{"bySession":';
    localStorage.setItem('claudia-right-workspace', corrupt);
    await useRightWorkspaceStore.persist.rehydrate();
    expect(useRightWorkspaceStore.persist.hasHydrated()).toBe(true);
    expect(localStorage.getItem('claudia-right-workspace:corrupt')).toBe(corrupt);
    useRightWorkspaceStore.getState().ensureChatSession('A');
    expect(localStorage.getItem('claudia-right-workspace:corrupt')).toBe(corrupt);
  });
});

describe('persisted project and preset metadata', () => {
  it.each([['claudia-right-sidebar', useRightSidebarStore]] as const)(
    'finishes the hydration gate when %s contains malformed JSON',
    async (key, store) => {
      const source = '{invalid legacy settings';
      localStorage.setItem(key, source);
      await store.persist.rehydrate();
      expect(store.persist.hasHydrated()).toBe(true);
      expect(localStorage.getItem(`${key}:corrupt`)).toBe(source);
    }
  );

  it('keeps a valid project anchor when only focus is corrupt, filtering invalid binding identities', async () => {
    const key = workspaceRefKey({ toolId: 'terminal', instanceKey: 'scope' });
    localStorage.setItem(
      'claudia-project-workspace',
      JSON.stringify({
        version: 1,
        state: {
          byProject: {
            p: {
              workspaceId: 'anchor',
              focusedChatSessionId: null,
              toolBindings: {
                [key]: { mode: 'fixed', sessionId: 'B' },
                invalid: { mode: 'fixed', sessionId: 'B' },
                '["chat","A"]': { mode: 'fixed', sessionId: 'B' },
              },
            },
          },
        },
      })
    );
    await useProjectWorkspaceStore.persist.rehydrate();
    expect(useProjectWorkspaceStore.getState().byProject.p).toEqual({
      workspaceId: 'anchor',
      focusedChatSessionId: 'anchor',
      toolBindings: { [key]: { mode: 'fixed', sessionId: 'B' } },
    });
  });

  it('recovers project metadata and preset library hydration from malformed JSON without losing source bytes', async () => {
    localStorage.setItem('claudia-project-workspace', '{bad project metadata');
    await useProjectWorkspaceStore.persist.rehydrate();
    expect(useProjectWorkspaceStore.persist.hasHydrated()).toBe(true);
    expect(localStorage.getItem('claudia-project-workspace:corrupt')).toBe('{bad project metadata');
    localStorage.setItem('claudia-layout-presets', '{bad preset library');
    await useLayoutPresetStore.persist.rehydrate();
    expect(useLayoutPresetStore.persist.hasHydrated()).toBe(true);
    expect(localStorage.getItem('claudia-layout-presets:corrupt')).toBe('{bad preset library');
  });

  it('retains custom presets while filtering a corrupt template on actual hydration', async () => {
    const tree = {
      kind: 'slots',
      slotId: 'custom-pane',
      slots: [{ slotId: 'chat-slot', kind: 'chat' }],
    };
    localStorage.setItem(
      'claudia-layout-presets',
      JSON.stringify({
        version: 1,
        state: {
          presets: [
            { id: 'custom', name: 'Saved', builtin: false, tree },
            {
              id: 'broken',
              name: 'Broken',
              builtin: false,
              tree: { ...tree, slots: [{ slotId: 'bad', kind: 'tool:chat' }] },
            },
          ],
          selectedByProject: { p: 'custom', other: 'broken' },
        },
      })
    );
    await useLayoutPresetStore.persist.rehydrate();
    expect(useLayoutPresetStore.getState().presets.some(p => p.id === 'custom')).toBe(true);
    expect(useLayoutPresetStore.getState().presets.some(p => p.id === 'broken')).toBe(false);
    expect(useLayoutPresetStore.getState().selectedByProject).toEqual({ p: 'custom' });
  });
});
