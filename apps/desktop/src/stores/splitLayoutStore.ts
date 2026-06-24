import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { findSingletonConflict } from './panelInstance';

export type SplitDir = 'row' | 'col';

export interface PaneNode {
  id: string;
  kind: 'pane';
  panelId: string;
  /**
   * Per-scope instance key for panels that are not plain singletons
   * (terminal = `${backendId}::${projectId}`). Undefined for singletons.
   * Two panes with the same panelId conflict iff one is a singleton, OR both
   * are multi-instance-but-per-scope and share this key — see panelInstance.ts.
   */
  instanceKey?: string;
}

export interface GroupNode {
  id: string;
  kind: 'group';
  dir: SplitDir;
  /** Share of the FIRST child, clamped to [MIN_RATIO, MAX_RATIO]. */
  ratio: number;
  children: [LayoutNode, LayoutNode];
}

export type LayoutNode = PaneNode | GroupNode;

export const MIN_RATIO = 0.1;
export const MAX_RATIO = 0.9;
const DEFAULT_RATIO = 0.5;

const clampRatio = (r: number) => Math.max(MIN_RATIO, Math.min(MAX_RATIO, r));

/** randomUUID with a fallback for environments without the WebCrypto global. */
function genId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

function newPane(panelId: string, instanceKey?: string): PaneNode {
  return { id: genId('pane'), kind: 'pane', panelId, instanceKey };
}

export type SplitResult = { ok: true; newPaneId: string } | { ok: false; conflictPaneId: string };

interface SplitLayoutState {
  root: LayoutNode | null;
  focusedPaneId: string | null;
  /** Initialize the single-pane layout (idempotent: no-op if a tree already exists). */
  initSingle: (panelId: string) => void;
  /**
   * Split `fromPaneId` in `dir`, inserting a new pane for `panelId` (with optional
   * `instanceKey`) as the SECOND child. The original pane keeps its first position.
   * Refuses if it would create a singleton/per-scope conflict. Returns the result.
   */
  split: (fromPaneId: string, dir: SplitDir, panelId: string, instanceKey?: string) => SplitResult;
  closePane: (paneId: string) => void;
  focusPane: (paneId: string) => void;
  setRatio: (groupId: string, ratio: number) => void;
  /** Replace the panel shown by a pane (center-drop). Refuses on conflict. */
  replacePane: (paneId: string, panelId: string, instanceKey?: string) => SplitResult;
  reset: () => void;
}

/** Path of group ids from root down to the parent of `paneId` (exclusive of the pane). */
export function pathTo(root: LayoutNode | null, paneId: string): string[] | null {
  if (!root) return null;
  if (root.kind === 'pane') return root.id === paneId ? [] : null;
  for (const child of root.children) {
    const sub = pathTo(child, paneId);
    if (sub !== null) return [root.id, ...sub];
  }
  return null;
}

export function findPane(root: LayoutNode | null, paneId: string): PaneNode | null {
  if (!root) return null;
  if (root.kind === 'pane') return root.id === paneId ? root : null;
  for (const child of root.children) {
    const hit = findPane(child, paneId);
    if (hit) return hit;
  }
  return null;
}

/** True when the layout tree has a group (i.e. two+ panes are visible at once). */
export function isSplitLayout(root: LayoutNode | null): boolean {
  return !!root && root.kind === 'group';
}

/** Immutably replace the node with id === `oldId` (anywhere in the tree) by `replacement`. */
function replaceChild(node: LayoutNode, oldId: string, replacement: LayoutNode): LayoutNode {
  if (node.id === oldId) return replacement;
  if (node.kind === 'pane') return node;
  const children = node.children.map((c) => replaceChild(c, oldId, replacement)) as [LayoutNode, LayoutNode];
  return { ...node, children };
}

/**
 * Remove a pane and collapse ancestor groups into the surviving sibling.
 * Returns the new root (or null if the root itself was removed).
 */
function removePane(root: LayoutNode, paneId: string): LayoutNode | null {
  if (root.kind === 'pane') return root.id === paneId ? null : root;
  const [a, b] = root.children;
  // If a direct child is the target pane, the group collapses to the sibling.
  if (a.kind === 'pane' && a.id === paneId) return b;
  if (b.kind === 'pane' && b.id === paneId) return a;
  // Otherwise recurse.
  const newA = removePane(a, paneId);
  const newB = removePane(b, paneId);
  return { ...root, children: [newA ?? a, newB ?? b] };
}

function setRatioAt(root: LayoutNode, groupId: string, ratio: number): LayoutNode {
  if (root.kind === 'pane') return root;
  const children = root.children.map((c) => setRatioAt(c, groupId, ratio)) as [LayoutNode, LayoutNode];
  return root.id === groupId
    ? { ...root, ratio: clampRatio(ratio), children }
    : { ...root, children };
}

function pickFirstPane(root: LayoutNode | null): string | null {
  if (!root) return null;
  if (root.kind === 'pane') return root.id;
  return pickFirstPane(root.children[0]);
}

export const useSplitLayoutStore = create<SplitLayoutState>()(
  persist(
    (set, get) => ({
      root: null,
      focusedPaneId: null,
      initSingle: (panelId) =>
        set((s) => (s.root ? {} : { root: newPane(panelId), focusedPaneId: null })),
      split: (fromPaneId, dir, panelId, instanceKey) => {
        const root = get().root;
        const target = findPane(root, fromPaneId);
        if (!target) return { ok: false, conflictPaneId: '' };
        // The source pane stays in the tree (split inserts a *new* pane beside
        // it), so the conflict check must consider ALL existing panes — pass an
        // id that matches nothing rather than excluding the source.
        const conflict = findSingletonConflict(root, panelId, instanceKey, '\u0000__split_new__');
        if (conflict) return { ok: false, conflictPaneId: conflict };
        const second = newPane(panelId, instanceKey);
        const group: GroupNode = {
          id: genId('grp'),
          kind: 'group',
          dir,
          ratio: DEFAULT_RATIO,
          children: [target, second],
        };
        set((s) => ({
          root: s.root ? replaceChild(s.root, fromPaneId, group) : s.root,
          focusedPaneId: second.id,
        }));
        return { ok: true, newPaneId: second.id };
      },
      closePane: (paneId) =>
        set((s) => {
          if (!s.root) return {};
          const next = removePane(s.root, paneId);
          if (next === s.root) return {}; // pane not found — no-op
          const focusNext =
            s.focusedPaneId === paneId ? pickFirstPane(next) : s.focusedPaneId;
          return { root: next, focusedPaneId: focusNext };
        }),
      focusPane: (paneId) => {
        if (findPane(get().root, paneId)) set({ focusedPaneId: paneId });
      },
      setRatio: (groupId, ratio) =>
        set((s) => ({ root: s.root ? setRatioAt(s.root, groupId, ratio) : s.root })),
      replacePane: (paneId, panelId, instanceKey) => {
        const root = get().root;
        const target = findPane(root, paneId);
        if (!target) return { ok: false, conflictPaneId: '' };
        const conflict = findSingletonConflict(root, panelId, instanceKey, paneId);
        if (conflict) return { ok: false, conflictPaneId: conflict };
        set((s) => ({
          root: s.root
            ? replaceChild(s.root, paneId, { ...target, panelId, instanceKey })
            : s.root,
          focusedPaneId: paneId,
        }));
        return { ok: true, newPaneId: '' };
      },
      reset: () => set({ root: null, focusedPaneId: null }),
    }),
    {
      name: 'claudia-split-layout',
      version: 1,
      partialize: (s) => ({ root: s.root, focusedPaneId: s.focusedPaneId }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SplitLayoutState>;
        const root = isSafeTree(p.root) ? p.root : null;
        return {
          ...current,
          ...p,
          root,
          focusedPaneId: root ? p.focusedPaneId ?? null : null,
        };
      },
    },
  ),
);

// `findSingletonConflict` is imported from ./panelInstance (per-scope singleton
// enforcement). Re-exported here for callers that import from the store.
export { findSingletonConflict };

/** Structural check used by the persist merge to drop corrupt persisted trees. */
export function isSafeTree(node: unknown): node is LayoutNode {
  if (!node || typeof node !== 'object') return false;
  const n = node as { kind?: unknown };
  if (n.kind === 'pane') {
    const p = node as PaneNode;
    return typeof p.id === 'string' && typeof p.panelId === 'string';
  }
  if (n.kind === 'group') {
    const g = node as GroupNode;
    return (
      typeof g.id === 'string' &&
      (g.dir === 'row' || g.dir === 'col') &&
      typeof g.ratio === 'number' &&
      Array.isArray(g.children) &&
      g.children.length === 2 &&
      isSafeTree(g.children[0]) &&
      isSafeTree(g.children[1])
    );
  }
  return false;
}
