import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { recoverableJsonStorage, workspaceStorageKey } from '../utils/workspaceStorage';
import {
  activeToolRef,
  flattenPanes,
  genId,
  isChatRef,
  isSafeTree,
  isWorkspaceSlotKind,
  MAX_RATIO,
  MIN_RATIO,
  type LayoutNode,
  type PaneNode,
  type PlaceholderNode,
  type SessionWorkspace,
  type SplitDir,
  type ToolRef,
  type WorkspaceSlotKind,
  workspaceRefKey,
} from '../utils/workspaceLayout';

export interface PresetSlot {
  slotId: string;
  kind: WorkspaceSlotKind;
}

export interface PresetPane {
  kind: 'slots';
  slotId: string;
  /** Several filled slots become tabs in the same pane. */
  slots: PresetSlot[];
}

export interface PresetGroup {
  kind: 'group';
  slotId: string;
  dir: SplitDir;
  ratio: number;
  children: [PresetNode, PresetNode];
}

export type PresetNode = PresetPane | PresetGroup;
export interface LayoutPreset {
  id: string;
  name: string;
  builtin: boolean;
  tree: PresetNode;
}

const pane = (slotId: string, ...kinds: WorkspaceSlotKind[]): PresetPane => ({
  kind: 'slots',
  slotId,
  slots: kinds.map((kind, index) => ({ slotId: `${slotId}-${index}`, kind })),
});
const split = (
  slotId: string,
  dir: SplitDir,
  ratio: number,
  a: PresetNode,
  b: PresetNode
): PresetGroup => ({
  kind: 'group',
  slotId,
  dir,
  ratio,
  children: [a, b],
});
const builtin = (id: string, name: string, tree: PresetNode): LayoutPreset => ({
  id,
  name,
  builtin: true,
  tree,
});

export const BUILTIN_LAYOUT_PRESETS: LayoutPreset[] = [
  builtin(
    'default',
    'Default',
    split(
      'default-root',
      'row',
      0.62,
      pane('default-chat', 'chat'),
      split(
        'default-tools',
        'col',
        0.56,
        pane('default-terminal', 'tool:terminal'),
        pane('default-memory', 'tool:memory')
      )
    )
  ),
  builtin(
    'review',
    'Review',
    split(
      'review-root',
      'row',
      0.6,
      pane('review-tools', 'tool:session-changes', 'tool:file-viewer'),
      pane('review-chat', 'chat')
    )
  ),
  builtin(
    'dock',
    'Dock',
    split(
      'dock-root',
      'col',
      0.6,
      pane('dock-tools', 'tool:browser', 'tool:session-changes'),
      pane('dock-chat', 'chat')
    )
  ),
  builtin(
    'preview',
    'Preview',
    split(
      'preview-root',
      'row',
      0.42,
      pane('preview-chat', 'chat'),
      split(
        'preview-tools',
        'col',
        0.62,
        pane('preview-browser', 'tool:browser'),
        pane('preview-terminal', 'tool:terminal')
      )
    )
  ),
  builtin('focus', 'Focus', pane('focus-chat', 'chat')),
  builtin(
    'compare',
    'Compare',
    split(
      'compare-root',
      'row',
      0.36,
      pane('compare-chat-1', 'chat'),
      split(
        'compare-right',
        'row',
        0.55,
        pane('compare-chat-2', 'chat'),
        pane('compare-terminal', 'tool:terminal')
      )
    )
  ),
  builtin(
    'main-watcher',
    'Main + watcher',
    split(
      'watcher-root',
      'row',
      0.6,
      pane('watcher-main', 'chat'),
      split(
        'watcher-right',
        'col',
        0.55,
        pane('watcher-chat', 'chat'),
        pane('watcher-git', 'tool:git')
      )
    )
  ),
  builtin(
    'session-tabs',
    'Session tabs',
    split(
      'tabs-root',
      'row',
      0.64,
      pane('tabs-chats', 'chat', 'chat', 'chat'),
      split(
        'tabs-tools',
        'col',
        0.56,
        pane('tabs-terminal', 'tool:terminal'),
        pane('tabs-memory', 'tool:memory')
      )
    )
  ),
];

export function isSafePresetTree(tree: unknown): tree is PresetNode {
  const ids = new Set<string>();
  const visit = (value: unknown, depth: number): boolean => {
    if (!value || typeof value !== 'object' || depth > 128) return false;
    const node = value as PresetNode;
    if (typeof node.slotId !== 'string' || !node.slotId || ids.has(node.slotId)) return false;
    ids.add(node.slotId);
    if (node.kind === 'slots') {
      if (!Array.isArray(node.slots) || !node.slots.length) return false;
      // A template pane cannot mix chat and tools, matching the pinned chat boundary.
      const chat = node.slots[0]?.kind === 'chat';
      return node.slots.every(slot => {
        if (
          !slot ||
          typeof slot.slotId !== 'string' ||
          !slot.slotId ||
          ids.has(slot.slotId) ||
          !isWorkspaceSlotKind(slot.kind) ||
          (slot.kind === 'chat') !== chat
        )
          return false;
        ids.add(slot.slotId);
        return true;
      });
    }
    return (
      node.kind === 'group' &&
      (node.dir === 'row' || node.dir === 'col') &&
      typeof node.ratio === 'number' &&
      node.ratio >= MIN_RATIO &&
      node.ratio <= MAX_RATIO &&
      Array.isArray(node.children) &&
      node.children.length === 2 &&
      node.children.every(child => visit(child, depth + 1))
    );
  };
  return visit(tree, 0);
}

/** Copy only the template fields; user presets never serialize live ref identities. */
function copyTemplate(node: PresetNode): PresetNode {
  return node.kind === 'slots'
    ? {
        kind: 'slots',
        slotId: node.slotId,
        slots: node.slots.map(slot => ({ slotId: slot.slotId, kind: slot.kind })),
      }
    : {
        kind: 'group',
        slotId: node.slotId,
        dir: node.dir,
        ratio: node.ratio,
        children: [copyTemplate(node.children[0]), copyTemplate(node.children[1])],
      };
}

/** Extract geometry and tab-slot kinds, without sessions, instance keys, focus or bindings. */
export function presetTreeFromLayout(root: LayoutNode): PresetNode {
  if (root.kind === 'group') {
    return {
      kind: 'group',
      slotId: `group-${root.id}`,
      dir: root.dir,
      ratio: root.ratio,
      children: [presetTreeFromLayout(root.children[0]), presetTreeFromLayout(root.children[1])],
    };
  }
  if (root.kind === 'placeholder') {
    return {
      kind: 'slots',
      slotId: `pane-${root.id}`,
      slots: [{ slotId: root.slotId, kind: root.accepts }],
    };
  }
  return {
    kind: 'slots',
    slotId: `pane-${root.id}`,
    slots: root.tools.map((ref, index) => ({
      slotId: `tab-${root.id}-${index}`,
      kind: isChatRef(ref) ? 'chat' : `tool:${ref.toolId}`,
    })),
  };
}

function collectPlaceholders(root: LayoutNode | null): PlaceholderNode[] {
  if (!root) return [];
  return root.kind === 'placeholder'
    ? [root]
    : root.kind === 'pane'
      ? []
      : [...collectPlaceholders(root.children[0]), ...collectPlaceholders(root.children[1])];
}

/**
 * Map each existing complete ref once. Excess refs are tabs, excess slots are
 * independent placeholders. The source pane and content-ref identities survive.
 */
export function mapLayoutPreset(
  ws: SessionWorkspace,
  preset: LayoutPreset,
  focusedChatSessionId?: string
): SessionWorkspace {
  if (!isSafePresetTree(preset.tree)) throw new Error('Invalid layout preset');
  const originalPanes = flattenPanes(ws.root);
  const unique = new Map<string, ToolRef>();
  for (const p of originalPanes)
    for (const ref of p.tools) {
      const key = workspaceRefKey(ref);
      if (!unique.has(key)) unique.set(key, ref);
    }
  const all = [...unique.values()];
  const focusedPane = originalPanes.find(p => p.id === ws.focusedPaneId);
  const activeChat =
    focusedPane && isChatRef(activeToolRef(focusedPane)) ? activeToolRef(focusedPane) : undefined;
  const focusChat =
    all.find(ref => isChatRef(ref) && ref.instanceKey === focusedChatSessionId) ??
    activeChat ??
    all.find(isChatRef);
  const chats = all.filter(isChatRef);
  const remainingChats = focusChat ? [focusChat, ...chats.filter(ref => ref !== focusChat)] : chats;
  const remainingTools = all.filter(ref => !isChatRef(ref));
  const usedPanes = new Set<string>();
  const usedNodeIds = new Set<string>([
    `preset-overflow-${preset.id}-chats`,
    `preset-overflow-${preset.id}-tools`,
  ]);
  const reserveTemplateGroups = (node: PresetNode) => {
    if (node.kind === 'group') {
      usedNodeIds.add(`preset-group-${preset.id}-${node.slotId}`);
      node.children.forEach(reserveTemplateGroups);
    } else
      for (let index = 0; index < node.slots.length - 1; index++) {
        usedNodeIds.add(`preset-missing-tabs-${preset.id}-${node.slotId}-${index}`);
      }
  };
  reserveTemplateGroups(preset.tree);
  const allocateNodeId = (base: string) => {
    let id = base;
    let suffix = 0;
    while (usedNodeIds.has(id)) id = `${base}-${++suffix}`;
    usedNodeIds.add(id);
    return id;
  };
  const outputPanes: PaneNode[] = [];
  const originals = collectPlaceholders(ws.root);
  const priorAssignments = new Map<string, ToolRef[]>();
  const findNode = (node: LayoutNode | null, id: string): LayoutNode | undefined => {
    if (!node) return undefined;
    if (node.id === id) return node;
    return node.kind === 'group'
      ? (findNode(node.children[0], id) ?? findNode(node.children[1], id))
      : undefined;
  };
  const align = (template: PresetNode, node: LayoutNode | undefined) => {
    if (!node) return;
    if (template.kind === 'slots') {
      priorAssignments.set(
        template.slotId,
        flattenPanes(node).flatMap(p => p.tools)
      );
    } else if (
      node.kind === 'group' &&
      node.id === `preset-group-${preset.id}-${template.slotId}`
    ) {
      align(template.children[0], node.children[0]);
      align(template.children[1], node.children[1]);
    }
  };
  // Retain assignments from the same template. Otherwise chat overflow would
  // change traversal order and swap the second slot on every repeated apply.
  align(
    preset.tree,
    preset.tree.kind === 'group'
      ? findNode(ws.root, `preset-group-${preset.id}-${preset.tree.slotId}`)
      : (ws.root ?? undefined)
  );
  let chatSlotSeen = false;

  const makePane = (slotId: string, refs: ToolRef[]): PaneNode => {
    const original = originalPanes.find(
      p =>
        !usedPanes.has(p.id) && p.tools.some(t => workspaceRefKey(t) === workspaceRefKey(refs[0]))
    );
    const baseId = `preset-pane-${preset.id}-${slotId}`;
    const id = allocateNodeId(original?.id ?? baseId);
    usedPanes.add(id);
    const originalActive = original ? activeToolRef(original) : undefined;
    const active =
      refs.find(ref => isChatRef(ref) && ref === focusChat) ??
      refs.find(
        ref => originalActive && workspaceRefKey(ref) === workspaceRefKey(originalActive)
      ) ??
      refs[0];
    const result: PaneNode = {
      id,
      kind: 'pane',
      tools: refs,
      activeToolId: active.toolId,
      activeInstanceKey: active.instanceKey,
    };
    outputPanes.push(result);
    return result;
  };
  const placeholder = (slot: PresetSlot): PlaceholderNode => ({
    id: allocateNodeId(
      originals.find(p => p.slotId === slot.slotId && p.accepts === slot.kind)?.id ??
        `preset-empty-${preset.id}-${slot.slotId}`
    ),
    kind: 'placeholder',
    slotId: slot.slotId,
    accepts: slot.kind,
  });
  const visit = (node: PresetNode): LayoutNode => {
    if (node.kind === 'group') {
      return {
        id: `preset-group-${preset.id}-${node.slotId}`,
        kind: 'group',
        dir: node.dir,
        ratio: node.ratio,
        children: [visit(node.children[0]), visit(node.children[1])],
      };
    }
    const assigned: ToolRef[] = [];
    const empty: PlaceholderNode[] = [];
    const prior = priorAssignments.get(node.slotId) ?? [];
    for (const slot of node.slots) {
      const pool = slot.kind === 'chat' ? remainingChats : remainingTools;
      const accepts = (ref: ToolRef) =>
        slot.kind === 'chat'
          ? isChatRef(ref)
          : slot.kind === `tool:${ref.toolId}` || slot.kind === 'tool:*';
      const previous = prior.find(
        ref => accepts(ref) && pool.some(t => workspaceRefKey(t) === workspaceRefKey(ref))
      );
      const preferFocus = slot.kind === 'chat' && !chatSlotSeen;
      const previousIndex = previous
        ? pool.findIndex(ref => workspaceRefKey(ref) === workspaceRefKey(previous))
        : -1;
      const index = preferFocus
        ? pool.length
          ? 0
          : -1
        : previousIndex >= 0
          ? previousIndex
          : pool.findIndex(accepts);
      if (slot.kind === 'chat') chatSlotSeen = true;
      if (index < 0) empty.push(placeholder(slot));
      else assigned.push(pool.splice(index, 1)[0]);
    }
    const leaves: LayoutNode[] = assigned.length
      ? [makePane(node.slotId, assigned), ...empty]
      : empty;
    // Empty tab slots have their own leaf identity; filled tabs remain together.
    return leaves.slice(1).reduce<LayoutNode>(
      (a, b, index) => ({
        id: `preset-missing-tabs-${preset.id}-${node.slotId}-${index}`,
        kind: 'group',
        dir: 'col',
        ratio: 0.5,
        children: [a, b],
      }),
      leaves[0]
    );
  };
  let root = visit(preset.tree);
  const appendOverflow = (refs: ToolRef[], chat: boolean) => {
    if (!refs.length) return;
    const landing = outputPanes.find(p => isChatRef(p.tools[0]) === chat);
    if (landing) {
      landing.tools.push(...refs);
      return;
    }
    const extra = makePane(chat ? 'overflow-chats' : 'overflow-tools', refs);
    root = {
      id: `preset-overflow-${preset.id}-${chat ? 'chats' : 'tools'}`,
      kind: 'group',
      dir: 'row',
      ratio: 0.7,
      children: [root, extra],
    };
  };
  appendOverflow(remainingChats, true);
  appendOverflow(remainingTools, false);
  for (const output of outputPanes) {
    const original = originalPanes.find(p => p.id === output.id);
    const oldActive = original ? activeToolRef(original) : undefined;
    const active =
      output.tools.find(ref => ref === focusChat) ??
      output.tools.find(ref => oldActive && workspaceRefKey(ref) === workspaceRefKey(oldActive));
    if (active) {
      output.activeToolId = active.toolId;
      output.activeInstanceKey = active.instanceKey;
    }
  }
  const panes = flattenPanes(root);
  const focus =
    panes.find(p => focusChat && p.tools.includes(focusChat)) ??
    panes.find(p => p.id === ws.focusedPaneId) ??
    panes[0];
  const primary =
    panes.find(p => !p.tools.some(isChatRef) && p.id === ws.primaryPaneId) ??
    panes.find(p => !p.tools.some(isChatRef));
  const maximizedPaneId = preset.id === 'focus' ? (focus?.id ?? null) : null;
  const next: SessionWorkspace = {
    ...ws,
    root,
    focusedPaneId: focus?.id ?? null,
    primaryPaneId: primary?.id ?? null,
    maximizedPaneId,
  };
  if (
    !isSafeTree(root) ||
    unique.size !==
      new Set(
        flattenPanes(root)
          .flatMap(p => p.tools)
          .map(workspaceRefKey)
      ).size
  ) {
    throw new Error('Invalid layout mapping');
  }
  // Stable generated group/placeholder IDs make applying the same template a no-op.
  return JSON.stringify(next) === JSON.stringify(ws) ? ws : next;
}

export type PresetMutationResult =
  | { ok: true; preset: LayoutPreset }
  | {
      ok: false;
      error: 'empty-name' | 'duplicate-name' | 'not-found' | 'builtin' | 'invalid-layout';
    };
interface LayoutPresetState {
  presets: LayoutPreset[];
  selectedByProject: Record<string, string>;
  createPreset: (name: string, tree: PresetNode) => PresetMutationResult;
  renamePreset: (id: string, name: string) => PresetMutationResult;
  deletePreset: (id: string) => PresetMutationResult;
  setProjectPreset: (projectId: string, presetId: string) => void;
}

function nameError(
  name: string,
  presets: LayoutPreset[],
  excludeId?: string
): 'empty-name' | 'duplicate-name' | undefined {
  if (!name.trim()) return 'empty-name';
  return presets.some(
    p => p.id !== excludeId && p.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase()
  )
    ? 'duplicate-name'
    : undefined;
}

function restore(saved: unknown): Pick<LayoutPresetState, 'presets' | 'selectedByProject'> {
  const value = saved as Partial<LayoutPresetState> | null;
  const presets = [...BUILTIN_LAYOUT_PRESETS];
  if (Array.isArray(value?.presets))
    for (const p of value.presets) {
      if (
        !p ||
        p.builtin ||
        typeof p.id !== 'string' ||
        !p.id ||
        typeof p.name !== 'string' ||
        presets.some(existing => existing.id === p.id) ||
        nameError(p.name, presets) ||
        !isSafePresetTree(p.tree)
      )
        continue;
      presets.push({ id: p.id, name: p.name.trim(), builtin: false, tree: copyTemplate(p.tree) });
    }
  const selections: [string, string][] = [];
  if (value?.selectedByProject && typeof value.selectedByProject === 'object') {
    for (const [projectId, id] of Object.entries(value.selectedByProject)) {
      if (presets.some(p => p.id === id)) selections.push([projectId, id as string]);
    }
  }
  return { presets, selectedByProject: Object.fromEntries(selections) };
}

const PRESET_LIBRARY_KEY = 'claudia-layout-presets';
const selectionKey = workspaceStorageKey(
  'claudia-layout-preset-selection',
  typeof window === 'undefined' ? '' : window.location.search
);
const mainWindow = selectionKey === 'claudia-layout-preset-selection';

function readSaved(key: string): { state?: Partial<LayoutPresetState>; version?: number } | null {
  try {
    const raw = recoverableJsonStorage(localStorage).getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Definitions remain a reusable global library; selection belongs to a window's
 * layout. Selection writes must not rewrite a stale copy of that global library.
 */
function presetStorage(): StateStorage {
  let previousDefinitions = '[]';
  return {
    getItem: name => {
      const library = readSaved(name);
      // A popup may be the first window to edit the shared library after an
      // upgrade. Move legacy main selections before any definitions-only write.
      const mainSelectionKey = 'claudia-layout-preset-selection';
      if (library?.state?.selectedByProject && !readSaved(mainSelectionKey)) {
        localStorage.setItem(
          mainSelectionKey,
          JSON.stringify({
            version: 1,
            state: { selectedByProject: library.state.selectedByProject },
          })
        );
      }
      const selections = readSaved(selectionKey);
      const presets = Array.isArray(library?.state?.presets) ? library.state.presets : [];
      previousDefinitions = JSON.stringify(presets);
      if (!library && !selections) return null;
      return JSON.stringify({
        version: 1,
        state: {
          presets,
          // Existing main-window selections migrate lazily, never into a popup.
          selectedByProject:
            selections?.state?.selectedByProject ??
            (mainWindow ? library?.state?.selectedByProject : {}) ??
            {},
        },
      });
    },
    setItem: (name, value) => {
      const saved = JSON.parse(value) as {
        state: Pick<LayoutPresetState, 'presets' | 'selectedByProject'>;
        version: number;
      };
      const definitions = JSON.stringify(saved.state.presets);
      if (definitions !== previousDefinitions) {
        localStorage.setItem(
          name,
          JSON.stringify({ state: { presets: saved.state.presets }, version: saved.version })
        );
        previousDefinitions = definitions;
      }
      localStorage.setItem(
        selectionKey,
        JSON.stringify({ state: { selectedByProject: saved.state.selectedByProject }, version: 1 })
      );
    },
    removeItem: name => {
      localStorage.removeItem(name);
      localStorage.removeItem(selectionKey);
      previousDefinitions = '[]';
    },
  };
}

export const useLayoutPresetStore = create<LayoutPresetState>()(
  persist(
    (set, get) => ({
      presets: [...BUILTIN_LAYOUT_PRESETS],
      selectedByProject: {},
      createPreset: (name, tree) => {
        const saved = readSaved(PRESET_LIBRARY_KEY);
        if (saved) set({ presets: restore(saved.state).presets });
        const error = nameError(name, get().presets);
        if (error) return { ok: false, error };
        if (!isSafePresetTree(tree)) return { ok: false, error: 'invalid-layout' };
        const preset: LayoutPreset = {
          id: genId('preset'),
          name: name.trim(),
          builtin: false,
          tree: copyTemplate(tree),
        };
        set(s => ({ presets: [...s.presets, preset] }));
        return { ok: true, preset };
      },
      renamePreset: (id, name) => {
        const saved = readSaved(PRESET_LIBRARY_KEY);
        if (saved) set({ presets: restore(saved.state).presets });
        const existing = get().presets.find(p => p.id === id);
        if (!existing) return { ok: false, error: 'not-found' };
        if (existing.builtin) return { ok: false, error: 'builtin' };
        const error = nameError(name, get().presets, id);
        if (error) return { ok: false, error };
        const preset = { ...existing, name: name.trim() };
        set(s => ({ presets: s.presets.map(p => (p.id === id ? preset : p)) }));
        return { ok: true, preset };
      },
      deletePreset: id => {
        const saved = readSaved(PRESET_LIBRARY_KEY);
        if (saved) set({ presets: restore(saved.state).presets });
        const preset = get().presets.find(p => p.id === id);
        if (!preset) return { ok: false, error: 'not-found' };
        if (preset.builtin) return { ok: false, error: 'builtin' };
        set(s => ({
          presets: s.presets.filter(p => p.id !== id),
          selectedByProject: Object.fromEntries(
            Object.entries(s.selectedByProject).filter(([, selected]) => selected !== id)
          ),
        }));
        return { ok: true, preset };
      },
      setProjectPreset: (projectId, presetId) => {
        if (
          !get().presets.some(p => p.id === presetId) ||
          get().selectedByProject[projectId] === presetId
        )
          return;
        set(s => ({ selectedByProject: { ...s.selectedByProject, [projectId]: presetId } }));
      },
    }),
    {
      name: PRESET_LIBRARY_KEY,
      version: 1,
      storage: createJSONStorage(presetStorage),
      partialize: s => ({
        presets: s.presets.filter(p => !p.builtin),
        selectedByProject: s.selectedByProject,
      }),
      migrate: saved => restore(saved),
      merge: (saved, current) => ({ ...current, ...restore(saved) }),
    }
  )
);
