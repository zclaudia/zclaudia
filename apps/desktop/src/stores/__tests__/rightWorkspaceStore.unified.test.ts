import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_TOOL_ID,
  findPane,
  flattenPanes,
  isPinnedPane,
  isSafeTree,
  newPane,
  normalizeSessionWorkspace,
  pruneChat,
  pruneTools,
  useRightWorkspaceStore,
  withChat,
  type GroupNode,
  type LayoutNode,
  type SessionWorkspace,
  type WorkspaceEdge,
} from '../rightWorkspaceStore';

const store = useRightWorkspaceStore;
const state = () => store.getState();
const workspace = () => state().bySession.A;
const chatPane = () => flattenPanes(workspace().root).find(isPinnedPane)!;
const refs = (root: LayoutNode | null) =>
  flattenPanes(root)
    .flatMap(p => p.tools)
    .map(t => JSON.stringify([t.toolId, t.instanceKey]))
    .sort();
const group = (a: LayoutNode, b: LayoutNode): GroupNode => ({
  id: `group-${a.id}-${b.id}`,
  kind: 'group',
  dir: 'row',
  ratio: 0.6,
  children: [a, b],
});

beforeEach(() => {
  store.setState({ bySession: {}, order: [] });
  localStorage.removeItem('claudia-right-workspace');
});

describe('unified workspace normalization and persistence', () => {
  it('adds chat once to existing or empty entries and preserves a moved layout on re-enable', () => {
    state().ensureSession('A');
    state().ensureChatSession('A', 0.65);
    const chat = chatPane();
    expect(chat.tools).toEqual([{ toolId: CHAT_TOOL_ID, instanceKey: 'A' }]);
    expect(workspace().primaryPaneId).toBeNull();
    expect(workspace().focusedPaneId).toBe(chat.id);
    expect(withChat(workspace().root, 'A', 0.3)).toBe(workspace().root);

    state().openTool('A', 'terminal', { instanceKey: 'backend::project', multiInstance: true });
    state().moveChatPane('A', 'bottom');
    const moved = workspace();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    state().ensureChatSession('A', 0.8);
    unsubscribe();
    expect(workspace()).toBe(moved);
    expect(chatPane().id).toBe(chat.id);
    expect(listener).not.toHaveBeenCalled();
  });

  it('preserves existing tool geometry, refs and valid metadata when chat is inserted', () => {
    const a = newPane('terminal', 'backend::project');
    const b = newPane('files');
    const root = group(a, b);
    const ws: SessionWorkspace = { root, primaryPaneId: b.id, focusedPaneId: a.id };
    const normalized = normalizeSessionWorkspace(ws, 'A', 0.7);
    expect(normalized.root).toMatchObject({ kind: 'group', ratio: 0.7 });
    expect(pruneChat(normalized.root)).toBe(root);
    expect(normalized.primaryPaneId).toBe(b.id);
    expect(normalized.focusedPaneId).toBe(a.id);
    expect(normalizeSessionWorkspace(normalized, 'A', 0.2)).toBe(normalized);
  });

  it('projections collapse nested groups without mutating pane IDs, tabs or ratios', () => {
    const chat = newPane(CHAT_TOOL_ID, 'A');
    const a = newPane('files');
    const b = newPane('terminal', 'backend::project');
    const tools = group(a, b);
    const root = group(tools, chat);
    expect(pruneChat(root)).toBe(tools);
    expect(pruneTools(root)).toBe(chat);
    expect(root.children).toEqual([tools, chat]);
  });

  it('hydrates serialized v1, writes the current format and reloads without inserting chat or losing the layout', async () => {
    const a = newPane('terminal', 'backend::project');
    const b = newPane('files');
    const root = group(a, b);
    const persisted = {
      state: {
        bySession: {
          A: { root, primaryPaneId: b.id, focusedPaneId: a.id },
          B: { root: null, primaryPaneId: null, focusedPaneId: null },
        },
        order: ['B', 'A'],
      },
      version: 1,
    };
    localStorage.setItem('claudia-right-workspace', JSON.stringify(persisted));
    await store.persist.rehydrate();
    expect(store.persist.hasHydrated()).toBe(true);
    expect(state().bySession).toEqual(persisted.state.bySession);
    expect(state().order).toEqual(['B', 'A']);
    expect(flattenPanes(workspace().root).some(isPinnedPane)).toBe(false);
    const written = localStorage.getItem('claudia-right-workspace')!;
    expect(JSON.parse(written).version).toBe(3);
    store.setState({ bySession: {}, order: [] });
    localStorage.setItem('claudia-right-workspace', written);
    await store.persist.rehydrate();
    expect(state().bySession).toEqual(persisted.state.bySession);

    // Feature enablement is a separate operation after hydration.
    state().ensureChatSession('A', 0.66);
    expect(pruneChat(workspace().root)).toEqual(root);
    expect(workspace().root).toMatchObject({ ratio: 0.66 });
  });

  it('repairs invalid persisted references and maximum while retaining a valid tree', async () => {
    const root = newPane('files');
    localStorage.setItem(
      'claudia-right-workspace',
      JSON.stringify({
        version: 2,
        state: {
          bySession: {
            A: { root, primaryPaneId: 'gone', focusedPaneId: 'gone', maximizedPaneId: 'gone' },
          },
          order: ['missing', 'A'],
        },
      })
    );
    await store.persist.rehydrate();
    expect(workspace()).toEqual({
      root,
      primaryPaneId: root.id,
      focusedPaneId: root.id,
      maximizedPaneId: null,
    });
    expect(state().order).toEqual(['A']);
  });
});

describe('pinned chat and tool landing rules', () => {
  it('creates the first tool next to chat, skips focused chat and recreates tools after all close', () => {
    state().ensureChatSession('A');
    const chat = chatPane();
    state().openTool('A', 'files');
    const tools = flattenPanes(workspace().root).find(p => !isPinnedPane(p))!;
    expect(workspace().primaryPaneId).toBe(tools.id);
    expect(workspace().focusedPaneId).toBe(tools.id);
    expect(workspace().root).toMatchObject({ dir: 'row', children: [chat, tools] });
    state().focusPane('A', chat.id);
    state().openTool('A', 'memory');
    expect(findPane(workspace().root, tools.id)?.tools.map(t => t.toolId)).toEqual([
      'files',
      'memory',
    ]);
    expect(chatPane().tools).toHaveLength(1);
    state().closePane('A', tools.id);
    expect(workspace().root).toBe(chat);
    expect(workspace().primaryPaneId).toBeNull();
    state().openTool('A', 'terminal', { instanceKey: 'backend::project', multiInstance: true });
    expect(flattenPanes(workspace().root)).toHaveLength(2);
    expect(chatPane()).toBe(chat);
  });

  it('blocks ordinary chat mutations and prevents merging tools into chat', () => {
    state().ensureChatSession('A');
    state().openTool('A', 'files');
    const chat = chatPane();
    const tool = flattenPanes(workspace().root).find(p => !isPinnedPane(p))!;
    const before = workspace();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    state().closePane('A', chat.id);
    state().closeTool('A', chat.id, CHAT_TOOL_ID, 'A');
    state().replaceTool('A', chat.id, 'memory');
    state().replaceTool('A', tool.id, CHAT_TOOL_ID, 'A');
    state().moveTab('A', chat.id, tool.id, CHAT_TOOL_ID, 'A');
    state().moveTab('A', tool.id, chat.id, 'files', undefined);
    state().splitTabOut('A', chat.id, CHAT_TOOL_ID, 'A', 'row');
    state().splitPane('A', tool.id, 'row', CHAT_TOOL_ID, 'A');
    state().openTool('A', CHAT_TOOL_ID, { instanceKey: 'A' });
    unsubscribe();
    expect(workspace()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    state().resetSession('A');
    expect(workspace().root).toBe(chat);
  });

  it('clears maximum on explicit tool open and closing the maximized pane', () => {
    state().ensureChatSession('A');
    state().openTool('A', 'files');
    const tool = flattenPanes(workspace().root).find(p => !isPinnedPane(p))!;
    state().setMaximizedPane('A', chatPane().id);
    state().openTool('A', 'files');
    expect(workspace().maximizedPaneId).toBeNull();
    state().setMaximizedPane('A', tool.id);
    state().closeTool('A', tool.id, 'files');
    expect(workspace().maximizedPaneId).toBeNull();
    state().setMaximizedPane('A', 'missing');
    expect(workspace().maximizedPaneId).toBeNull();
  });
});

describe('atomic edge movement', () => {
  it.each<WorkspaceEdge>(['left', 'right', 'top', 'bottom'])(
    'moves a last tool tab to chat %s in one submission and retains pane/ref identity',
    edge => {
      state().ensureChatSession('A');
      state().openTool('A', 'terminal', { instanceKey: 'backend::project', multiInstance: true });
      const chat = chatPane();
      const from = flattenPanes(workspace().root).find(p => !isPinnedPane(p))!;
      const beforeRefs = refs(workspace().root);
      const listener = vi.fn();
      const unsubscribe = store.subscribe(listener);
      const result = state().moveTabToEdge(
        'A',
        from.id,
        chat.id,
        'terminal',
        'backend::project',
        edge
      );
      unsubscribe();
      expect(result).toEqual({ ok: true, newPaneId: from.id });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(findPane(workspace().root, from.id)).toBe(from);
      expect(chatPane()).toBe(chat);
      expect(refs(workspace().root)).toEqual(beforeRefs);
      expect(workspace().root).toMatchObject({
        dir: edge === 'left' || edge === 'right' ? 'row' : 'col',
        children: edge === 'left' || edge === 'top' ? [from, chat] : [chat, from],
      });
    }
  );

  it.each<WorkspaceEdge>(['left', 'right', 'top', 'bottom'])(
    'moves chat to a tool or root %s without changing its pane ID',
    edge => {
      state().ensureChatSession('A');
      state().openTool('A', 'files');
      const chat = chatPane();
      const tool = flattenPanes(workspace().root).find(p => !isPinnedPane(p))!;
      const before = refs(workspace().root);
      expect(state().moveChatPane('A', edge, tool.id)).toEqual({ ok: true, newPaneId: chat.id });
      expect(chatPane()).toBe(chat);
      expect(state().moveChatPane('A', edge)).toEqual({ ok: true, newPaneId: chat.id });
      expect(chatPane()).toBe(chat);
      expect(refs(workspace().root)).toEqual(before);
    }
  );

  it('splits a source tab directly at chat without mixing it into chat or copying its ref', () => {
    state().ensureChatSession('A');
    state().openTool('A', 'files');
    state().openTool('A', 'memory');
    const chat = chatPane();
    const source = flattenPanes(workspace().root).find(p => !isPinnedPane(p))!;
    const movedRef = source.tools[1];
    const before = refs(workspace().root);
    const listener = vi.fn(next => {
      expect(flattenPanes(next.bySession.A.root).filter(isPinnedPane)).toEqual([chat]);
    });
    const unsubscribe = store.subscribe(listener);
    const result = state().moveTabToEdge('A', source.id, chat.id, 'memory', undefined, 'top');
    unsubscribe();
    expect(result.ok).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    if (result.ok) expect(findPane(workspace().root, result.newPaneId)?.tools[0]).toBe(movedRef);
    expect(findPane(workspace().root, source.id)?.tools).toEqual([source.tools[0]]);
    expect(refs(workspace().root)).toEqual(before);
    expect(isSafeTree(workspace().root)).toBe(true);
  });

  it('finds nested targets after empty source collapse and handles a same-pane partial split', () => {
    const chat = newPane(CHAT_TOOL_ID, 'A');
    const source = newPane('memory');
    const target = newPane('files');
    const root = group(chat, group(source, target));
    store.setState({
      bySession: { A: { root, primaryPaneId: source.id, focusedPaneId: source.id } },
      order: ['A'],
    });
    const before = refs(root);
    expect(state().moveTabToEdge('A', source.id, target.id, 'memory', undefined, 'bottom').ok).toBe(
      true
    );
    expect(refs(workspace().root)).toEqual(before);
    expect(workspace().primaryPaneId).toBe(source.id);
    state().openTool('A', 'search');
    const result = state().moveTabToEdge('A', source.id, source.id, 'search', undefined, 'right');
    expect(result.ok).toBe(true);
    expect(findPane(workspace().root, source.id)?.tools.map(t => t.toolId)).toEqual(['memory']);
  });

  it('rejects missing targets, center, pinned sources, duplicate refs and single-tab self splits without submissions', () => {
    const chat = newPane(CHAT_TOOL_ID, 'A');
    const source = newPane('memory');
    const duplicate = newPane('memory');
    const root = group(chat, group(source, duplicate));
    store.setState({
      bySession: { A: { root, primaryPaneId: source.id, focusedPaneId: source.id } },
      order: ['A'],
    });
    const before = workspace();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(state().moveTabToEdge('A', source.id, 'gone', 'memory', undefined, 'left').ok).toBe(
      false
    );
    expect(
      state().moveTabToEdge('A', source.id, chat.id, 'memory', undefined, 'center' as WorkspaceEdge)
        .ok
    ).toBe(false);
    expect(state().moveTabToEdge('A', chat.id, source.id, CHAT_TOOL_ID, 'A', 'left').ok).toBe(
      false
    );
    expect(state().moveTabToEdge('A', source.id, chat.id, 'memory', undefined, 'left')).toEqual({
      ok: false,
      conflictPaneId: duplicate.id,
    });
    expect(state().moveTabToEdge('A', source.id, source.id, 'memory', undefined, 'right').ok).toBe(
      false
    );
    expect(state().moveChatPane('A', 'left', 'gone').ok).toBe(false);
    expect(state().moveChatPane('A', 'left', chat.id).ok).toBe(false);
    unsubscribe();
    expect(workspace()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });
});
