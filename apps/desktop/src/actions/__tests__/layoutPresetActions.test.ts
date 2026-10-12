import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyLayoutPreset,
  fillChatSlot,
  fillToolSlot,
  saveCurrentLayoutPreset,
} from '../layoutPresetActions';
import { selectProjectChat, resolveProjectWorkspace } from '../projectWorkspaceActions';
import { BUILTIN_LAYOUT_PRESETS, useLayoutPresetStore } from '../../stores/layoutPresetStore';
import {
  CHAT_TOOL_ID,
  flattenPanes,
  isChatRef,
  useRightWorkspaceStore,
  type LayoutNode,
  type PlaceholderNode,
} from '../../stores/rightWorkspaceStore';
import {
  resolveToolBindingSession,
  useProjectWorkspaceStore,
  workspaceRefKey,
} from '../../stores/projectWorkspaceStore';
import { usePluginStore } from '../../stores/pluginStore';
import { useRightSidebarStore } from '../../stores/rightSidebarStore';
import { useProjectStore } from '../../stores/projectStore';

const onOpen = vi.fn();
const onClose = vi.fn();
const projectId = 'project';
const current = () => useRightWorkspaceStore.getState().bySession.A;
const placeholders = (root: LayoutNode | null): PlaceholderNode[] => {
  if (!root || root.kind === 'pane') return [];
  return root.kind === 'placeholder'
    ? [root]
    : [...placeholders(root.children[0]), ...placeholders(root.children[1])];
};
const refs = () => flattenPanes(current().root).flatMap(p => p.tools);

beforeEach(() => {
  useRightWorkspaceStore.setState({ bySession: {}, order: [] });
  useProjectWorkspaceStore.setState({ byProject: {} });
  useLayoutPresetStore.setState({ presets: [...BUILTIN_LAYOUT_PRESETS], selectedByProject: {} });
  useRightSidebarStore.setState({ collapsed: true });
  useProjectStore.setState({
    sessions: ['A', 'B', 'C'].map(id => ({
      id,
      projectId,
      type: 'regular' as const,
      createdAt: 1,
      updatedAt: 1,
    })),
  });
  usePluginStore.setState({
    panels: ['terminal', 'memory', 'file-viewer', 'browser', 'git'].map(id => ({
      id,
      pluginId: 'builtin',
      type: 'panel' as const,
      label: id,
      onOpen,
      onClose,
    })),
  });
  onOpen.mockClear();
  onClose.mockClear();
  resolveProjectWorkspace(projectId, ['A', 'B', 'C'], 'A');
});

describe('atomic preset actions', () => {
  it('applies in one layout notification, preserves bindings and refs, and never fires panel lifecycle', () => {
    selectProjectChat(projectId, 'B', { beside: true });
    selectProjectChat(projectId, 'C', { beside: true });
    useRightWorkspaceStore
      .getState()
      .openTool('A', 'terminal', { instanceKey: 'be::project', multiInstance: true });
    useRightWorkspaceStore
      .getState()
      .openTool('A', 'terminal', { instanceKey: 'be::worktree', multiInstance: true });
    const terminal = refs().find(t => t.instanceKey === 'be::worktree')!;
    useProjectWorkspaceStore
      .getState()
      .setToolBinding(projectId, terminal, { mode: 'fixed', sessionId: 'B' });
    const beforeKeys = refs().map(workspaceRefKey).sort();
    const listener = vi.fn();
    const unsubscribe = useRightWorkspaceStore.subscribe(listener);
    expect(applyLayoutPreset(projectId, 'compare')).toEqual({ ok: true, workspaceId: 'A' });
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(refs().map(workspaceRefKey).sort()).toEqual(beforeKeys);
    expect(refs().find(t => t.instanceKey === 'be::worktree')).toBe(terminal);
    expect(resolveToolBindingSession(projectId, terminal)).toBe('B');
    expect(useProjectWorkspaceStore.getState().byProject.project.focusedChatSessionId).toBe('C');
    expect(useLayoutPresetStore.getState().selectedByProject.project).toBe('compare');
    expect(useRightSidebarStore.getState().collapsed).toBe(false);
    expect(onOpen).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    const secondListener = vi.fn();
    const secondUnsubscribe = useRightWorkspaceStore.subscribe(secondListener);
    applyLayoutPreset(projectId, 'compare');
    secondUnsubscribe();
    expect(secondListener).not.toHaveBeenCalled();
  });

  it('saves a user template and reapplies it to different live sessions without copying saved identity', () => {
    useRightWorkspaceStore
      .getState()
      .openTool('A', 'terminal', { instanceKey: 'backend::project', multiInstance: true });
    const saved = saveCurrentLayoutPreset(projectId, 'Working layout');
    if (!saved.ok) throw new Error('Expected saved preset');
    expect(useLayoutPresetStore.getState().selectedByProject.project).toBe(saved.preset.id);
    expect(JSON.stringify(saved.preset.tree)).not.toContain('backend::project');
    selectProjectChat(projectId, 'B');
    expect(applyLayoutPreset(projectId, saved.preset.id).ok).toBe(true);
    expect(
      refs()
        .filter(isChatRef)
        .map(t => t.instanceKey)
    ).toEqual(['B']);
  });

  it('returns concrete errors without changing layout or opening anything', () => {
    const before = current();
    expect(applyLayoutPreset(projectId, 'missing')).toEqual({ ok: false, error: 'not-found' });
    expect(applyLayoutPreset('missing-project', 'compare')).toEqual({
      ok: false,
      error: 'workspace-not-found',
    });
    expect(current()).toBe(before);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('explicit placeholder filling', () => {
  it('adds a new chosen session to the empty Compare slot without replacing the existing chat', () => {
    applyLayoutPreset(projectId, 'compare');
    const empty = placeholders(current().root).find(p => p.accepts === 'chat')!;
    const first = refs().find(isChatRef);
    const listener = vi.fn();
    const unsubscribe = useRightWorkspaceStore.subscribe(listener);
    const result = fillChatSlot(projectId, empty.id, 'B');
    unsubscribe();
    expect(result.ok).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(
      refs()
        .filter(isChatRef)
        .map(t => t.instanceKey)
    ).toEqual(['A', 'B']);
    expect(refs().find(t => t.instanceKey === 'A')).toBe(first);
    expect(placeholders(current().root).some(p => p.id === empty.id)).toBe(false);
    expect(useProjectWorkspaceStore.getState().byProject.project.focusedChatSessionId).toBe('B');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('selecting an already-open session focuses its original instance and leaves the slot empty', () => {
    applyLayoutPreset(projectId, 'compare');
    const empty = placeholders(current().root).find(p => p.accepts === 'chat')!;
    const original = flattenPanes(current().root).find(p => p.tools.some(isChatRef))!;
    expect(fillChatSlot(projectId, empty.id, 'A')).toEqual({ ok: true, paneId: original.id });
    expect(refs().filter(isChatRef)).toHaveLength(1);
    expect(placeholders(current().root).some(p => p.id === empty.id)).toBe(true);
    expect(current().focusedPaneId).toBe(original.id);
  });

  it('explicitly fills a tool slot once, with its complete terminal scope and opening lifecycle', () => {
    applyLayoutPreset(projectId, 'compare');
    const empty = placeholders(current().root).find(p => p.accepts === 'tool:terminal')!;
    expect(onOpen).not.toHaveBeenCalled();
    const result = fillToolSlot(projectId, empty.id, 'terminal', { projectId, backendId: 'be' });
    expect(result.ok).toBe(true);
    expect(refs()).toContainEqual({ toolId: 'terminal', instanceKey: 'be::project' });
    expect(onOpen).toHaveBeenCalledExactlyOnceWith({ sessionId: 'A', projectId, backendId: 'be' });
    expect(onClose).not.toHaveBeenCalled();
    expect(placeholders(current().root).some(p => p.id === empty.id)).toBe(false);
  });

  it('focuses an existing tool instance when its empty slot is selected instead of duplicating it', () => {
    applyLayoutPreset(projectId, 'compare');
    const empty = placeholders(current().root).find(p => p.accepts === 'tool:terminal')!;
    useRightWorkspaceStore
      .getState()
      .openTool('A', 'terminal', { instanceKey: 'be::project', multiInstance: true });
    const existing = flattenPanes(current().root).find(p =>
      p.tools.some(t => t.toolId === 'terminal')
    )!;
    expect(fillToolSlot(projectId, empty.id, 'terminal', { backendId: 'be' })).toEqual({
      ok: true,
      paneId: existing.id,
    });
    expect(refs().filter(t => t.toolId === 'terminal')).toHaveLength(1);
    expect(placeholders(current().root).some(p => p.id === empty.id)).toBe(true);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('rejects wrong slot kinds, missing slots and unavailable panels without creating refs', () => {
    applyLayoutPreset(projectId, 'compare');
    const chat = placeholders(current().root).find(p => p.accepts === 'chat')!;
    const tool = placeholders(current().root).find(p => p.accepts === 'tool:terminal')!;
    const before = current();
    expect(fillChatSlot(projectId, tool.id, 'B')).toEqual({ ok: false, error: 'wrong-slot-kind' });
    expect(fillToolSlot(projectId, chat.id, 'memory')).toEqual({
      ok: false,
      error: 'wrong-slot-kind',
    });
    expect(fillToolSlot(projectId, tool.id, 'memory')).toEqual({
      ok: false,
      error: 'wrong-slot-kind',
    });
    expect(fillChatSlot(projectId, 'gone', 'B')).toEqual({ ok: false, error: 'slot-not-found' });
    usePluginStore.setState({ panels: [] });
    expect(fillToolSlot(projectId, tool.id, 'terminal')).toEqual({
      ok: false,
      error: 'panel-not-found',
    });
    expect(current()).toBe(before);
    expect(refs()).toEqual([{ toolId: CHAT_TOOL_ID, instanceKey: 'A' }]);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('rejects nonexistent, other-project and archived sessions without changing the empty slot', () => {
    applyLayoutPreset(projectId, 'compare');
    const empty = placeholders(current().root).find(p => p.accepts === 'chat')!;
    useProjectStore.setState(state => ({
      sessions: [
        ...state.sessions,
        { id: 'other', projectId: 'other-project', type: 'regular', createdAt: 1, updatedAt: 1 },
        { id: 'archived', projectId, type: 'regular', createdAt: 1, updatedAt: 1, archivedAt: 2 },
      ],
    }));
    const before = current();
    for (const id of ['missing', 'other', 'archived']) {
      expect(fillChatSlot(projectId, empty.id, id)).toEqual({
        ok: false,
        error: 'session-not-found',
      });
    }
    expect(current()).toBe(before);
  });

  it('distinguishes terminal full refs while repeated singleton slots focus the original instance', () => {
    const layout = useLayoutPresetStore.getState().createPreset('Two terminal scopes', {
      kind: 'group',
      slotId: 'root',
      dir: 'row',
      ratio: 0.5,
      children: [
        { kind: 'slots', slotId: 'chat', slots: [{ slotId: 'chat-1', kind: 'chat' }] },
        {
          kind: 'slots',
          slotId: 'terminals',
          slots: [
            { slotId: 'terminal-1', kind: 'tool:terminal' },
            { slotId: 'terminal-2', kind: 'tool:terminal' },
            { slotId: 'memory-1', kind: 'tool:memory' },
            { slotId: 'memory-2', kind: 'tool:memory' },
          ],
        },
      ],
    });
    if (!layout.ok) throw new Error('Expected created preset');
    useRightWorkspaceStore
      .getState()
      .openTool('A', 'terminal', { instanceKey: 'be::project', multiInstance: true });
    useRightWorkspaceStore.getState().openTool('A', 'memory');
    applyLayoutPreset(projectId, layout.preset.id);
    const terminalEmpty = placeholders(current().root).find(p => p.accepts === 'tool:terminal')!;
    expect(fillToolSlot(projectId, terminalEmpty.id, 'terminal', { backendId: 'other' }).ok).toBe(
      true
    );
    expect(
      refs()
        .filter(t => t.toolId === 'terminal')
        .map(t => t.instanceKey)
        .sort()
    ).toEqual(['be::project', 'other::project']);
    const memoryEmpty = placeholders(current().root).find(p => p.accepts === 'tool:memory')!;
    onOpen.mockClear();
    expect(fillToolSlot(projectId, memoryEmpty.id, 'memory').ok).toBe(true);
    expect(refs().filter(t => t.toolId === 'memory')).toHaveLength(1);
    expect(onOpen).not.toHaveBeenCalled();
    expect(placeholders(current().root).some(p => p.id === memoryEmpty.id)).toBe(true);
  });
});
