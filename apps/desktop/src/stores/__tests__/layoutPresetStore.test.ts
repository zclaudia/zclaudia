import { beforeEach, describe, expect, it } from 'vitest';
import {
  BUILTIN_LAYOUT_PRESETS,
  isSafePresetTree,
  mapLayoutPreset,
  presetTreeFromLayout,
  useLayoutPresetStore,
  type LayoutPreset,
  type PresetNode,
} from '../layoutPresetStore';
import {
  CHAT_TOOL_ID,
  flattenPanes,
  isChatRef,
  isSafeTree,
  newPane,
  useRightWorkspaceStore,
  type LayoutNode,
  type PlaceholderNode,
  type SessionWorkspace,
  type ToolRef,
} from '../rightWorkspaceStore';
import { workspaceRefKey } from '../projectWorkspaceStore';

const preset = (id: string) => BUILTIN_LAYOUT_PRESETS.find(p => p.id === id)!;
const refs = (root: LayoutNode | null) => flattenPanes(root).flatMap(p => p.tools);
const keys = (root: LayoutNode | null) => refs(root).map(workspaceRefKey).sort();
const placeholders = (root: LayoutNode | null): PlaceholderNode[] => {
  if (!root || root.kind === 'pane') return [];
  return root.kind === 'placeholder'
    ? [root]
    : [...placeholders(root.children[0]), ...placeholders(root.children[1])];
};
const split = (a: LayoutNode, b: LayoutNode): LayoutNode => ({
  id: `group-${a.id}-${b.id}`,
  kind: 'group',
  dir: 'row',
  ratio: 0.6,
  children: [a, b],
});
function workspace(
  sessionIds = ['A', 'B', 'C'],
  tools: ToolRef[] = [
    { toolId: 'terminal', instanceKey: 'be::project' },
    { toolId: 'terminal', instanceKey: 'be::worktree' },
    { toolId: 'file-viewer' },
    { toolId: 'memory' },
  ]
): SessionWorkspace {
  const chatPanes = sessionIds.map(id => newPane(CHAT_TOOL_ID, id));
  let root: LayoutNode = chatPanes.reduce(split);
  let primaryPaneId: string | null = null;
  if (tools.length) {
    const pane = { ...newPane(tools[0].toolId, tools[0].instanceKey), tools };
    primaryPaneId = pane.id;
    root = split(root, pane);
  }
  return { root, primaryPaneId, focusedPaneId: chatPanes[chatPanes.length - 1].id };
}

beforeEach(() => {
  useLayoutPresetStore.setState({ presets: [...BUILTIN_LAYOUT_PRESETS], selectedByProject: {} });
  useRightWorkspaceStore.setState({ bySession: {}, order: [] });
  localStorage.removeItem('claudia-layout-presets');
  localStorage.removeItem('claudia-layout-preset-selection');
});

describe('one-to-one preset mapping', () => {
  it.each(BUILTIN_LAYOUT_PRESETS)(
    '$name preserves all complete refs and is exactly idempotent',
    layout => {
      const original = workspace();
      const next = mapLayoutPreset(original, layout, 'C');
      expect(isSafeTree(next.root)).toBe(true);
      expect(keys(next.root)).toEqual(keys(original.root));
      for (const ref of refs(original.root))
        expect(refs(next.root).find(t => workspaceRefKey(t) === workspaceRefKey(ref))).toBe(ref);
      expect(mapLayoutPreset(next, layout, 'C')).toBe(next);
      const ids = flattenPanes(next.root).map(p => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      // Mapping never changes or mutates the input pane/tool arrays.
      expect(
        refs(original.root)
          .map(t => t.instanceKey)
          .filter(Boolean)
      ).toEqual(['A', 'B', 'C', 'be::project', 'be::worktree']);
    }
  );

  it.each(['compare', 'main-watcher'])(
    '%s prioritizes focus and keeps extra chats as tabs in the first chat pane',
    id => {
      const next = mapLayoutPreset(workspace(['A', 'B', 'C'], []), preset(id), 'C');
      const chats = flattenPanes(next.root).filter(p => p.tools.some(isChatRef));
      expect(chats).toHaveLength(2);
      expect(chats[0].tools.map(t => t.instanceKey)).toEqual(['C', 'B']);
      expect(chats[1].tools.map(t => t.instanceKey)).toEqual(['A']);
      expect(chats[0].activeInstanceKey).toBe('C');
      expect(next.focusedPaneId).toBe(chats[0].id);
    }
  );

  it('merges three chats into session tabs without duplicating or changing session identities', () => {
    const next = mapLayoutPreset(workspace(['A', 'B', 'C'], []), preset('session-tabs'), 'B');
    const chats = flattenPanes(next.root).filter(p => p.tools.some(isChatRef));
    expect(chats).toHaveLength(1);
    expect(chats[0].tools.map(t => t.instanceKey)).toEqual(['B', 'A', 'C']);
    expect(chats[0].activeInstanceKey).toBe('B');
  });

  it('represents excess chat slots independently and does not create or duplicate sessions', () => {
    const next = mapLayoutPreset(workspace(['A'], []), preset('compare'), 'A');
    expect(refs(next.root)).toEqual([{ toolId: CHAT_TOOL_ID, instanceKey: 'A' }]);
    const emptyChats = placeholders(next.root).filter(p => p.accepts === 'chat');
    expect(emptyChats).toHaveLength(1);
    expect(emptyChats[0]).toMatchObject({ kind: 'placeholder', slotId: 'compare-chat-2-0' });
    expect('tools' in emptyChats[0]).toBe(false);
    expect(mapLayoutPreset(next, preset('compare'), 'A')).toBe(next);
  });

  it('represents empty tab slots independently while keeping filled chats in one tab pane', () => {
    const next = mapLayoutPreset(workspace(['A', 'B'], []), preset('session-tabs'), 'A');
    expect(flattenPanes(next.root)).toHaveLength(1);
    expect(
      refs(next.root)
        .filter(isChatRef)
        .map(t => t.instanceKey)
    ).toEqual(['A', 'B']);
    expect(placeholders(next.root).filter(p => p.accepts === 'chat')).toHaveLength(1);
  });

  it('keeps tools in an extra pane for Focus, uses maximum for visibility and restores on another preset', () => {
    const original = workspace();
    const focus = mapLayoutPreset(original, preset('focus'), 'B');
    expect(keys(focus.root)).toEqual(keys(original.root));
    expect(focus.maximizedPaneId).toBe(focus.focusedPaneId);
    expect(flattenPanes(focus.root).filter(p => !p.tools.some(isChatRef))).toHaveLength(1);
    const preview = mapLayoutPreset(focus, preset('preview'), 'B');
    expect(preview.maximizedPaneId).toBeNull();
  });

  it('does not copy a singleton into repeated template slots and retains multi-instance tool keys', () => {
    const repeated: LayoutPreset = {
      id: 'repeat',
      name: 'Repeat',
      builtin: false,
      tree: {
        kind: 'slots',
        slotId: 'tools',
        slots: [
          { slotId: 'memory-1', kind: 'tool:memory' },
          { slotId: 'memory-2', kind: 'tool:memory' },
          { slotId: 'term-1', kind: 'tool:terminal' },
          { slotId: 'term-2', kind: 'tool:terminal' },
        ],
      },
    };
    const original = workspace(['A']);
    const next = mapLayoutPreset(original, repeated, 'A');
    expect(refs(next.root).filter(t => t.toolId === 'memory')).toHaveLength(1);
    expect(
      refs(next.root)
        .filter(t => t.toolId === 'terminal')
        .map(t => t.instanceKey)
    ).toEqual(['be::project', 'be::worktree']);
    expect(placeholders(next.root).map(p => p.slotId)).toContain('memory-2');
    expect(keys(next.root)).toEqual(keys(original.root));
  });

  it('retains original active tool refs when moving all tabs into a compatible pane', () => {
    const original = workspace(['A']);
    const tools = flattenPanes(original.root).find(p => !p.tools.some(isChatRef))!;
    tools.activeToolId = 'terminal';
    tools.activeInstanceKey = 'be::worktree';
    const simple: LayoutPreset = {
      id: 'simple',
      name: 'Simple',
      builtin: false,
      tree: {
        kind: 'group',
        slotId: 'root',
        dir: 'row',
        ratio: 0.5,
        children: [
          { kind: 'slots', slotId: 'chat', slots: [{ slotId: 'chat-1', kind: 'chat' }] },
          { kind: 'slots', slotId: 'tools', slots: [{ slotId: 'tool-1', kind: 'tool:*' }] },
        ],
      },
    };
    const next = mapLayoutPreset(original, simple, 'A');
    const mappedTools = flattenPanes(next.root).find(p => !p.tools.some(isChatRef))!;
    expect(mappedTools.id).toBe(tools.id);
    expect(mappedTools.activeInstanceKey).toBe('be::worktree');
  });

  it('avoids pane ID collisions when split layouts are merged and then split with a new focus', () => {
    let ws = mapLayoutPreset(workspace(['A', 'B'], []), preset('compare'), 'A');
    ws = mapLayoutPreset(ws, preset('session-tabs'), 'B');
    ws = mapLayoutPreset(ws, preset('compare'), 'B');
    const panes = flattenPanes(ws.root);
    expect(new Set(panes.map(p => p.id)).size).toBe(panes.length);
    expect(mapLayoutPreset(ws, preset('compare'), 'B')).toBe(ws);
  });
});

describe('preset persistence and CRUD', () => {
  it('saves geometry and tab kinds without sessions, instance keys or bindings', () => {
    const original = workspace(
      ['private-session'],
      [{ toolId: 'terminal', instanceKey: 'private-backend::private-project' }]
    );
    const template = presetTreeFromLayout(original.root!);
    expect(isSafePresetTree(template)).toBe(true);
    const result = useLayoutPresetStore.getState().createPreset('My layout', template);
    expect(result.ok).toBe(true);
    const serialized = localStorage.getItem('claudia-layout-presets')!;
    expect(serialized).not.toContain('private-session');
    expect(serialized).not.toContain('private-backend');
    expect(serialized).not.toContain('private-project');
    expect(JSON.parse(serialized).state.presets).toHaveLength(1);
  });

  it('handles trimmed name conflicts and protects builtins', () => {
    const api = useLayoutPresetStore.getState();
    expect(api.createPreset(' review ', preset('focus').tree)).toEqual({
      ok: false,
      error: 'duplicate-name',
    });
    expect(api.createPreset('   ', preset('focus').tree)).toEqual({
      ok: false,
      error: 'empty-name',
    });
    const saved = api.createPreset('Mine', preset('focus').tree);
    if (!saved.ok) throw new Error('Expected created preset');
    expect(api.renamePreset(saved.preset.id, ' default ')).toEqual({
      ok: false,
      error: 'duplicate-name',
    });
    expect(api.renamePreset(saved.preset.id, ' Updated ')).toMatchObject({
      ok: true,
      preset: { name: 'Updated' },
    });
    expect(api.renamePreset('focus', 'Else')).toEqual({ ok: false, error: 'builtin' });
    expect(api.deletePreset('default')).toEqual({ ok: false, error: 'builtin' });
    api.setProjectPreset('project', saved.preset.id);
    expect(api.deletePreset(saved.preset.id).ok).toBe(true);
    expect(useLayoutPresetStore.getState().selectedByProject).toEqual({});
  });

  it('rejects mixed pane slots and duplicate slot identities', () => {
    const mixed: PresetNode = {
      kind: 'slots',
      slotId: 'mixed',
      slots: [
        { slotId: 'chat', kind: 'chat' },
        { slotId: 'tool', kind: 'tool:terminal' },
      ],
    };
    expect(isSafePresetTree(mixed)).toBe(false);
    expect(
      isSafePresetTree({ kind: 'slots', slotId: 'pane', slots: [{ slotId: 'pane', kind: 'chat' }] })
    ).toBe(false);
  });

  it('rehydrates custom presets and remembered project selection without duplicating builtins', async () => {
    const saved = useLayoutPresetStore.getState().createPreset('Mine', preset('compare').tree);
    if (!saved.ok) throw new Error('Expected created preset');
    useLayoutPresetStore.getState().setProjectPreset('project', saved.preset.id);
    const serialized = localStorage.getItem('claudia-layout-presets')!;
    const selection = localStorage.getItem('claudia-layout-preset-selection')!;
    useLayoutPresetStore.setState({ presets: [...BUILTIN_LAYOUT_PRESETS], selectedByProject: {} });
    localStorage.setItem('claudia-layout-presets', serialized);
    localStorage.setItem('claudia-layout-preset-selection', selection);
    await useLayoutPresetStore.persist.rehydrate();
    expect(useLayoutPresetStore.getState().presets).toHaveLength(9);
    expect(useLayoutPresetStore.getState().selectedByProject.project).toBe(saved.preset.id);
  });

  it('hydrates v2 to v3 preserving complete references and persists/reloads placeholder trees', async () => {
    const original = workspace(['A']);
    localStorage.setItem(
      'claudia-right-workspace',
      JSON.stringify({ version: 2, state: { bySession: { A: original }, order: ['A'] } })
    );
    await useRightWorkspaceStore.persist.rehydrate();
    expect(useRightWorkspaceStore.getState().bySession.A).toEqual(original);
    expect(JSON.parse(localStorage.getItem('claudia-right-workspace')!).version).toBe(3);
    const mapped = mapLayoutPreset(original, preset('compare'), 'A');
    useRightWorkspaceStore.setState({ bySession: { A: mapped }, order: ['A'] });
    const saved = localStorage.getItem('claudia-right-workspace')!;
    useRightWorkspaceStore.setState({ bySession: {}, order: [] });
    localStorage.setItem('claudia-right-workspace', saved);
    await useRightWorkspaceStore.persist.rehydrate();
    expect(useRightWorkspaceStore.getState().bySession.A).toEqual(mapped);
    expect(placeholders(mapped.root).filter(p => p.accepts === 'chat')).toHaveLength(1);
  });
});
