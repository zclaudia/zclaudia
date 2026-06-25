import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SplitDir = 'row' | 'col';

/** One tool slot inside a pane. Panes hold an array (tab-ready); length 1 today. */
export interface ToolRef {
  toolId: string;
  /** Per-scope key for multi-instance tools (terminal = `${backendId}::${projectId}`). */
  instanceKey?: string;
}

export interface PaneNode {
  id: string;
  kind: 'pane';
  tools: ToolRef[];      // always length 1 in Phases 1–2
  activeToolId: string;  // == tools[0].toolId today
}

export interface GroupNode {
  id: string;
  kind: 'group';
  dir: SplitDir;
  ratio: number;         // share of the FIRST child, clamped [MIN_RATIO, MAX_RATIO]
  children: [LayoutNode, LayoutNode];
}

export type LayoutNode = PaneNode | GroupNode;

export interface SessionWorkspace {
  root: LayoutNode | null;        // null = empty → launcher
  primaryPaneId: string | null;   // default landing pane for openTool
  focusedPaneId: string | null;
}

export type SplitResult = { ok: true; newPaneId: string } | { ok: false; conflictPaneId: string };

export const MIN_RATIO = 0.1;
export const MAX_RATIO = 0.9;
export const DEFAULT_RATIO = 0.5;
const clampRatio = (r: number) => Math.max(MIN_RATIO, Math.min(MAX_RATIO, r));

export function genId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

export function newPane(toolId: string, instanceKey?: string): PaneNode {
  return { id: genId('pane'), kind: 'pane', tools: [{ toolId, instanceKey }], activeToolId: toolId };
}

/** The pane's currently-active tool ref (falls back to the first slot). */
export function activeToolRef(pane: PaneNode): ToolRef {
  return pane.tools.find((t) => t.toolId === pane.activeToolId) ?? pane.tools[0];
}

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

/** First pane that already holds the tool. Singleton: match toolId. Multi: match toolId+instanceKey. */
export function findPaneWithTool(
  root: LayoutNode | null,
  toolId: string,
  instanceKey: string | undefined,
  singleton: boolean,
): string | null {
  let hit: string | null = null;
  const visit = (node: LayoutNode | null) => {
    if (!node || hit) return;
    if (node.kind === 'pane') {
      for (const t of node.tools) {
        if (t.toolId !== toolId) continue;
        if (singleton || t.instanceKey === instanceKey) { hit = node.id; return; }
      }
      return;
    }
    visit(node.children[0]);
    visit(node.children[1]);
  };
  visit(root);
  return hit;
}

/** Conflicting pane for placing (toolId, instanceKey), excluding `excludePaneId`. */
export function findToolConflict(
  root: LayoutNode | null,
  toolId: string,
  instanceKey: string | undefined,
  singleton: boolean,
  excludePaneId: string,
): string | null {
  let conflict: string | null = null;
  const visit = (node: LayoutNode | null) => {
    if (!node || conflict) return;
    if (node.kind === 'pane') {
      if (node.id === excludePaneId) return;
      for (const t of node.tools) {
        if (t.toolId !== toolId) continue;
        if (singleton || t.instanceKey === instanceKey) { conflict = node.id; return; }
      }
      return;
    }
    visit(node.children[0]);
    visit(node.children[1]);
  };
  visit(root);
  return conflict;
}

export function replaceChild(node: LayoutNode, oldId: string, replacement: LayoutNode): LayoutNode {
  if (node.id === oldId) return replacement;
  if (node.kind === 'pane') return node;
  const children = node.children.map((c) => replaceChild(c, oldId, replacement)) as [LayoutNode, LayoutNode];
  return { ...node, children };
}

/** Callers only ever pass `kind:'pane'` node IDs; group nodes are never passed as `paneId`, which is why the `newA ?? a` / `newB ?? b` fallbacks are safe (a removed subtree is always a single pane, never a group that should itself be collapsed). */
export function removePane(root: LayoutNode, paneId: string): LayoutNode | null {
  if (root.kind === 'pane') return root.id === paneId ? null : root;
  const [a, b] = root.children;
  if (a.kind === 'pane' && a.id === paneId) return b;
  if (b.kind === 'pane' && b.id === paneId) return a;
  const newA = removePane(a, paneId);
  const newB = removePane(b, paneId);
  return { ...root, children: [newA ?? a, newB ?? b] };
}

export function setRatioAt(root: LayoutNode, groupId: string, ratio: number): LayoutNode {
  if (root.kind === 'pane') return root;
  const children = root.children.map((c) => setRatioAt(c, groupId, ratio)) as [LayoutNode, LayoutNode];
  return root.id === groupId ? { ...root, ratio: clampRatio(ratio), children } : { ...root, children };
}

export function pickFirstPane(root: LayoutNode | null): string | null {
  if (!root) return null;
  if (root.kind === 'pane') return root.id;
  return pickFirstPane(root.children[0]);
}

export function isSafeTree(node: unknown): node is LayoutNode {
  if (!node || typeof node !== 'object') return false;
  const n = node as { kind?: unknown };
  if (n.kind === 'pane') {
    const p = node as PaneNode;
    return (
      typeof p.id === 'string' &&
      Array.isArray(p.tools) && p.tools.length > 0 &&
      p.tools.every((t) => t && typeof t.toolId === 'string') &&
      typeof p.activeToolId === 'string' && p.activeToolId.length > 0
    );
  }
  if (n.kind === 'group') {
    const g = node as GroupNode;
    return (
      typeof g.id === 'string' &&
      (g.dir === 'row' || g.dir === 'col') &&
      typeof g.ratio === 'number' && g.ratio >= MIN_RATIO && g.ratio <= MAX_RATIO &&
      Array.isArray(g.children) && g.children.length === 2 &&
      isSafeTree(g.children[0]) && isSafeTree(g.children[1])
    );
  }
  return false;
}

export function isSplitWorkspace(root: LayoutNode | null): boolean {
  return !!root && root.kind === 'group';
}

const MAX_SESSIONS = 50;
const EMPTY: SessionWorkspace = { root: null, primaryPaneId: null, focusedPaneId: null };

export interface OpenToolOpts {
  instanceKey?: string;
  target?: 'primary' | 'focused' | 'new-split';
  openMode?: 'shared' | 'dedicated';
  multiInstance?: boolean;
}

interface RightWorkspaceState {
  bySession: Record<string, SessionWorkspace>;
  /** MRU order of sessionIds; front = most recent. Used for LRU eviction. */
  order: string[];
  ensureSession: (sessionId: string) => void;
  openTool: (sessionId: string, toolId: string, opts?: OpenToolOpts) => void;
  closePane: (sessionId: string, paneId: string) => void;
  splitPane: (sessionId: string, fromPaneId: string, dir: SplitDir, toolId: string, instanceKey?: string, multiInstance?: boolean) => SplitResult;
  replaceTool: (sessionId: string, paneId: string, toolId: string, instanceKey?: string, multiInstance?: boolean) => SplitResult;
  setRatio: (sessionId: string, groupId: string, ratio: number) => void;
  focusPane: (sessionId: string, paneId: string) => void;
  resetSession: (sessionId: string) => void;
  removeSession: (sessionId: string) => void;
}

/** Bump a sessionId to the front of MRU order and evict the oldest beyond MAX. */
function touch(order: string[], bySession: Record<string, SessionWorkspace>, sessionId: string) {
  const next = [sessionId, ...order.filter((id) => id !== sessionId)];
  while (next.length > MAX_SESSIONS) {
    const victim = next.pop()!;
    delete bySession[victim];
  }
  return next;
}

export const useRightWorkspaceStore = create<RightWorkspaceState>()(
  persist(
    (set, _get) => {
      /** Apply `mut` to a fresh copy of the session's workspace, then persist + touch MRU. */
      const update = (sessionId: string, mut: (ws: SessionWorkspace) => SessionWorkspace) =>
        set((s) => {
          const bySession = { ...s.bySession };
          const current = bySession[sessionId] ?? { ...EMPTY };
          bySession[sessionId] = mut({ ...current });
          const order = touch([...s.order], bySession, sessionId);
          return { bySession, order };
        });

      return {
        bySession: {},
        order: [],

        ensureSession: (sessionId) =>
          set((s) => {
            if (s.bySession[sessionId]) return {};
            const bySession = { ...s.bySession, [sessionId]: { ...EMPTY } };
            return { bySession, order: touch([...s.order], bySession, sessionId) };
          }),

        openTool: (sessionId, toolId, opts = {}) =>
          update(sessionId, (ws) => {
            const singleton = !opts.multiInstance;
            const instanceKey = opts.instanceKey;

            // 1) Already open → focus it (and make it the pane's active tool).
            const existing = findPaneWithTool(ws.root, toolId, instanceKey, singleton);
            if (existing) {
              const pane = findPane(ws.root, existing)!;
              const root = replaceChild(ws.root!, existing, { ...pane, activeToolId: toolId });
              return { ...ws, root, focusedPaneId: existing };
            }

            const ref = newPane(toolId, instanceKey);

            // 2) Empty workspace → seed as primary + focused.
            if (!ws.root) {
              return { root: ref, primaryPaneId: ref.id, focusedPaneId: ref.id };
            }

            const target = opts.target ?? (opts.openMode === 'dedicated' ? 'new-split' : 'primary');

            // 3a) primary → replace the primary pane's tool (fallback: seed if missing).
            if (target === 'primary') {
              const primaryId = ws.primaryPaneId && findPane(ws.root, ws.primaryPaneId)
                ? ws.primaryPaneId
                : pickFirstPane(ws.root);
              if (!primaryId) return { root: ref, primaryPaneId: ref.id, focusedPaneId: ref.id };
              const pane = findPane(ws.root, primaryId)!;
              const replaced: PaneNode = { ...pane, tools: [{ toolId, instanceKey }], activeToolId: toolId };
              return { ...ws, root: replaceChild(ws.root, primaryId, replaced), primaryPaneId: primaryId, focusedPaneId: primaryId };
            }

            // 3b) focused → replace the focused pane's tool.
            if (target === 'focused') {
              const focusId = ws.focusedPaneId && findPane(ws.root, ws.focusedPaneId)
                ? ws.focusedPaneId
                : pickFirstPane(ws.root)!;
              const pane = findPane(ws.root, focusId)!;
              const replaced: PaneNode = { ...pane, tools: [{ toolId, instanceKey }], activeToolId: toolId };
              return { ...ws, root: replaceChild(ws.root, focusId, replaced), focusedPaneId: focusId };
            }

            // 3c) new-split (dedicated) → split off a new pane beside the primary.
            const fromId = ws.primaryPaneId && findPane(ws.root, ws.primaryPaneId)
              ? ws.primaryPaneId
              : pickFirstPane(ws.root)!;
            const fromPane = findPane(ws.root, fromId)!;
            const group: GroupNode = {
              id: genId('grp'), kind: 'group', dir: 'row', ratio: DEFAULT_RATIO,
              children: [fromPane, ref],
            };
            return { ...ws, root: replaceChild(ws.root, fromId, group), focusedPaneId: ref.id };
          }),

        splitPane: (sessionId, fromPaneId, dir, toolId, instanceKey, multiInstance) => {
          const ws = _get().bySession[sessionId];
          if (!ws?.root || !findPane(ws.root, fromPaneId)) return { ok: false, conflictPaneId: '' };
          const singleton = !multiInstance;
          const conflict = findToolConflict(ws.root, toolId, instanceKey, singleton, ' __new__');
          if (conflict) return { ok: false, conflictPaneId: conflict };
          const fromPane = findPane(ws.root, fromPaneId)!;
          const ref = newPane(toolId, instanceKey);
          const group: GroupNode = {
            id: genId('grp'), kind: 'group', dir, ratio: DEFAULT_RATIO,
            children: [fromPane, ref],
          };
          update(sessionId, (w) => ({ ...w, root: replaceChild(w.root!, fromPaneId, group), focusedPaneId: ref.id }));
          return { ok: true, newPaneId: ref.id };
        },

        replaceTool: (sessionId, paneId, toolId, instanceKey, multiInstance) => {
          const ws = _get().bySession[sessionId];
          const pane = ws?.root ? findPane(ws.root, paneId) : null;
          if (!pane) return { ok: false, conflictPaneId: '' };
          const singleton = !multiInstance;
          const conflict = findToolConflict(ws!.root, toolId, instanceKey, singleton, paneId);
          if (conflict) return { ok: false, conflictPaneId: conflict };
          const replaced: PaneNode = { ...pane, tools: [{ toolId, instanceKey }], activeToolId: toolId };
          update(sessionId, (w) => ({ ...w, root: replaceChild(w.root!, paneId, replaced), focusedPaneId: paneId }));
          return { ok: true, newPaneId: '' };
        },

        closePane: (sessionId, paneId) =>
          update(sessionId, (ws) => {
            if (!ws.root) return ws;
            const next = removePane(ws.root, paneId);
            if (next === ws.root) return ws; // not found
            const primaryPaneId =
              ws.primaryPaneId === paneId ? pickFirstPane(next) : ws.primaryPaneId;
            const focusedPaneId =
              ws.focusedPaneId === paneId ? pickFirstPane(next) : ws.focusedPaneId;
            return { root: next, primaryPaneId, focusedPaneId };
          }),

        setRatio: (sessionId, groupId, ratio) =>
          update(sessionId, (ws) => (ws.root ? { ...ws, root: setRatioAt(ws.root, groupId, ratio) } : ws)),

        focusPane: (sessionId, paneId) =>
          update(sessionId, (ws) => (findPane(ws.root, paneId) ? { ...ws, focusedPaneId: paneId } : ws)),

        resetSession: (sessionId) => update(sessionId, () => ({ ...EMPTY })),

        removeSession: (sessionId) =>
          set((s) => {
            if (!s.bySession[sessionId]) return {};
            const bySession = { ...s.bySession };
            delete bySession[sessionId];
            return { bySession, order: s.order.filter((id) => id !== sessionId) };
          }),
      };
    },
    {
      name: 'claudia-right-workspace',
      version: 1,
      partialize: (s) => ({ bySession: s.bySession, order: s.order }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<RightWorkspaceState>;
        const bySession: Record<string, SessionWorkspace> = {};
        for (const [id, ws] of Object.entries(p.bySession ?? {})) {
          const root = ws && isSafeTree(ws.root) ? ws.root : null;
          bySession[id] = {
            root,
            primaryPaneId: root ? ws?.primaryPaneId ?? null : null,
            focusedPaneId: root ? ws?.focusedPaneId ?? null : null,
          };
        }
        const order = (p.order ?? []).filter((id) => id in bySession);
        return { ...current, bySession, order };
      },
    },
  ),
);

// One-time cleanup of the retired global split-layout persistence.
if (typeof localStorage !== 'undefined') {
  try { localStorage.removeItem('claudia-split-layout'); } catch { /* ignore */ }
}
