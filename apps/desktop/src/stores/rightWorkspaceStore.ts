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
      typeof g.ratio === 'number' &&
      Array.isArray(g.children) && g.children.length === 2 &&
      isSafeTree(g.children[0]) && isSafeTree(g.children[1])
    );
  }
  return false;
}

export function isSplitWorkspace(root: LayoutNode | null): boolean {
  return !!root && root.kind === 'group';
}

// Store object and actions will be added in Tasks 3–5.
// These imports are here for use by later tasks.
void create;
void persist;
