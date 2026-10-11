export type SplitDir = 'row' | 'col';
export type WorkspaceEdge = 'left' | 'right' | 'top' | 'bottom';
export const CHAT_TOOL_ID = 'chat';

/** One tool slot inside a pane. Panes hold an array (tab-ready); length 1 today. */
export interface ToolRef {
  toolId: string;
  /** Per-scope key for multi-instance tools (terminal = `${backendId}::${projectId}`). */
  instanceKey?: string;
}

export interface PaneNode {
  id: string;
  kind: 'pane';
  tools: ToolRef[]; // 1..N tabs
  activeToolId: string; // active tab's toolId
  activeInstanceKey?: string; // active tab's instanceKey (disambiguates multi-instance tabs)
}

export interface GroupNode {
  id: string;
  kind: 'group';
  dir: SplitDir;
  ratio: number; // share of the FIRST child, clamped [MIN_RATIO, MAX_RATIO]
  children: [LayoutNode, LayoutNode];
}

export type WorkspaceSlotKind = 'chat' | `tool:${string}`;

/** An unfilled preset slot has its own identity and never masquerades as an empty pane. */
export interface PlaceholderNode {
  id: string;
  kind: 'placeholder';
  slotId: string;
  accepts: WorkspaceSlotKind;
}

export type LayoutNode = PaneNode | GroupNode | PlaceholderNode;

export interface SessionWorkspace {
  root: LayoutNode | null; // null = empty → launcher
  primaryPaneId: string | null; // default landing pane for openTool
  focusedPaneId: string | null;
  maximizedPaneId?: string | null;
}

export type SplitResult = { ok: true; newPaneId: string } | { ok: false; conflictPaneId: string };

export const MIN_RATIO = 0.1;
export const MAX_RATIO = 0.9;
export const DEFAULT_RATIO = 0.5;
const clampRatio = (r: number) => Math.max(MIN_RATIO, Math.min(MAX_RATIO, r));

export const isChatRef = (ref: ToolRef): boolean => ref.toolId === CHAT_TOOL_ID;
export const isPinnedPane = (pane: PaneNode): boolean => pane.tools.some(isChatRef);

export function flattenPanes(root: LayoutNode | null): PaneNode[] {
  if (!root) return [];
  if (root.kind === 'placeholder') return [];
  return root.kind === 'pane'
    ? [root]
    : [...flattenPanes(root.children[0]), ...flattenPanes(root.children[1])];
}

/** Projection helpers never mutate the complete tree used by the content hosts. */
function pruneRefs(root: LayoutNode | null, keep: (ref: ToolRef) => boolean): LayoutNode | null {
  if (!root) return null;
  if (root.kind === 'placeholder') {
    return keep({ toolId: root.accepts === 'chat' ? CHAT_TOOL_ID : root.accepts.slice(5) }) ? root : null;
  }
  if (root.kind === 'pane') {
    const tools = root.tools.filter(keep);
    if (!tools.length) return null;
    if (tools.length === root.tools.length) return root;
    const active = tools.find(t => sameRef(t, root.activeToolId, root.activeInstanceKey)) ?? tools[0];
    return { ...root, tools, activeToolId: active.toolId, activeInstanceKey: active.instanceKey };
  }
  const a = pruneRefs(root.children[0], keep);
  const b = pruneRefs(root.children[1], keep);
  if (!a) return b;
  if (!b) return a;
  return a === root.children[0] && b === root.children[1]
    ? root
    : { ...root, children: [a, b] };
}

/** Remove chat refs for the legacy, tools-only workspace. */
export const pruneChat = (root: LayoutNode | null): LayoutNode | null =>
  pruneRefs(root, ref => !isChatRef(ref));

/** Chat-only geometry for collapsed tools; this is not a content mount list. */
export const pruneTools = (root: LayoutNode | null): LayoutNode | null => pruneRefs(root, isChatRef);

export function withChat(
  root: LayoutNode | null,
  sessionId: string,
  ratio = DEFAULT_RATIO
): LayoutNode {
  if (root && flattenPanes(root).some(p => p.tools.some(t => sameRef(t, CHAT_TOOL_ID, sessionId)))) {
    return root;
  }
  const chat = newPane(CHAT_TOOL_ID, sessionId);
  if (!root) return chat;
  return {
    id: genId('grp'), kind: 'group', dir: 'row',
    ratio: clampRatio(Number.isFinite(ratio) ? ratio : DEFAULT_RATIO), children: [chat, root],
  };
}

/** Repair metadata without consulting feature flags or changing layout geometry. */
export function repairWorkspace(ws: SessionWorkspace): SessionWorkspace {
  const panes = flattenPanes(ws.root);
  const tools = panes.filter(p => !isPinnedPane(p));
  const primary = tools.some(p => p.id === ws.primaryPaneId)
    ? ws.primaryPaneId : (tools[0]?.id ?? null);
  const focused = panes.some(p => p.id === ws.focusedPaneId)
    ? ws.focusedPaneId : (tools[0]?.id ?? panes[0]?.id ?? null);
  const maximized = ws.maximizedPaneId && panes.some(p => p.id === ws.maximizedPaneId)
    ? ws.maximizedPaneId : null;
  if (primary === ws.primaryPaneId && focused === ws.focusedPaneId &&
      (ws.maximizedPaneId === undefined || maximized === ws.maximizedPaneId)) return ws;
  return {
    ...ws, primaryPaneId: primary, focusedPaneId: focused,
    ...(ws.maximizedPaneId !== undefined ? { maximizedPaneId: maximized } : {}),
  };
}

export function normalizeSessionWorkspace(
  ws: SessionWorkspace,
  sessionId: string,
  ratio = DEFAULT_RATIO
): SessionWorkspace {
  const root = withChat(ws.root, sessionId, ratio);
  return repairWorkspace(root === ws.root ? ws : { ...ws, root });
}

export function genId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

export function newPane(toolId: string, instanceKey?: string): PaneNode {
  return {
    id: genId('pane'),
    kind: 'pane',
    tools: [{ toolId, instanceKey }],
    activeToolId: toolId,
    activeInstanceKey: instanceKey,
  };
}

/** True when `t` is the tab identified by (toolId, instanceKey). */
export function sameRef(t: ToolRef, toolId: string, instanceKey?: string): boolean {
  return t.toolId === toolId && t.instanceKey === instanceKey;
}

/** The pane's active tool ref: exact (toolId+instanceKey) match, then toolId-only, then first slot. */
export function activeToolRef(pane: PaneNode): ToolRef {
  return (
    pane.tools.find(
      t => t.toolId === pane.activeToolId && t.instanceKey === pane.activeInstanceKey
    ) ??
    pane.tools.find(t => t.toolId === pane.activeToolId) ??
    pane.tools[0]
  );
}

export function pathTo(root: LayoutNode | null, paneId: string): string[] | null {
  if (!root) return null;
  if (root.kind !== 'group') return root.id === paneId ? [] : null;
  for (const child of root.children) {
    const sub = pathTo(child, paneId);
    if (sub !== null) return [root.id, ...sub];
  }
  return null;
}

export function findPane(root: LayoutNode | null, paneId: string): PaneNode | null {
  if (!root) return null;
  if (root.kind === 'placeholder') return null;
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
  singleton: boolean
): string | null {
  let hit: string | null = null;
  const visit = (node: LayoutNode | null) => {
    if (!node || hit) return;
    if (node.kind === 'placeholder') return;
    if (node.kind === 'pane') {
      for (const t of node.tools) {
        if (t.toolId !== toolId) continue;
        if (singleton || t.instanceKey === instanceKey) {
          hit = node.id;
          return;
        }
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
  excludePaneId: string
): string | null {
  let conflict: string | null = null;
  const visit = (node: LayoutNode | null) => {
    if (!node || conflict) return;
    if (node.kind === 'placeholder') return;
    if (node.kind === 'pane') {
      if (node.id === excludePaneId) return;
      for (const t of node.tools) {
        if (t.toolId !== toolId) continue;
        if (singleton || t.instanceKey === instanceKey) {
          conflict = node.id;
          return;
        }
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
  if (node.kind !== 'group') return node;
  const children = node.children.map(c => replaceChild(c, oldId, replacement)) as [
    LayoutNode,
    LayoutNode,
  ];
  return { ...node, children };
}

/** Callers only ever pass `kind:'pane'` node IDs; group nodes are never passed as `paneId`, which is why the `newA ?? a` / `newB ?? b` fallbacks are safe (a removed subtree is always a single pane, never a group that should itself be collapsed). */
export function removePane(root: LayoutNode, paneId: string): LayoutNode | null {
  if (root.kind !== 'group') return root.id === paneId ? null : root;
  const [a, b] = root.children;
  if (a.kind !== 'group' && a.id === paneId) return b;
  if (b.kind !== 'group' && b.id === paneId) return a;
  const newA = removePane(a, paneId);
  const newB = removePane(b, paneId);
  return { ...root, children: [newA ?? a, newB ?? b] };
}

export function setRatioAt(root: LayoutNode, groupId: string, ratio: number): LayoutNode {
  if (root.kind !== 'group') return root;
  const children = root.children.map(c => setRatioAt(c, groupId, ratio)) as [
    LayoutNode,
    LayoutNode,
  ];
  return root.id === groupId
    ? { ...root, ratio: clampRatio(ratio), children }
    : { ...root, children };
}

export function pickFirstPane(root: LayoutNode | null): string | null {
  if (!root) return null;
  if (root.kind === 'placeholder') return null;
  if (root.kind === 'pane') return root.id;
  return pickFirstPane(root.children[0]) ?? pickFirstPane(root.children[1]);
}

export function isSafeTree(node: unknown): node is LayoutNode {
  if (!node || typeof node !== 'object') return false;
  const n = node as { kind?: unknown };
  if (n.kind === 'placeholder') {
    const p = node as PlaceholderNode;
    return typeof p.id === 'string' && p.id.length > 0 &&
      typeof p.slotId === 'string' && p.slotId.length > 0 &&
      typeof p.accepts === 'string' && (p.accepts === 'chat' ||
        (p.accepts.startsWith('tool:') && p.accepts.length > 5));
  }
  if (n.kind === 'pane') {
    const p = node as PaneNode;
    return (
      typeof p.id === 'string' &&
      Array.isArray(p.tools) &&
      p.tools.length > 0 &&
      p.tools.every(t => t && typeof t.toolId === 'string') &&
      typeof p.activeToolId === 'string' &&
      p.activeToolId.length > 0
    );
  }
  if (n.kind === 'group') {
    const g = node as GroupNode;
    return (
      typeof g.id === 'string' &&
      (g.dir === 'row' || g.dir === 'col') &&
      typeof g.ratio === 'number' &&
      g.ratio >= MIN_RATIO &&
      g.ratio <= MAX_RATIO &&
      Array.isArray(g.children) &&
      g.children.length === 2 &&
      isSafeTree(g.children[0]) &&
      isSafeTree(g.children[1])
    );
  }
  return false;
}

export function isSplitWorkspace(root: LayoutNode | null): boolean {
  return !!root && root.kind === 'group';
}

/** JSON tuples distinguish complete ref identities without delimiter collisions. */
export const workspaceRefKey = (ref: ToolRef): string =>
  JSON.stringify([ref.toolId, ref.instanceKey ?? null]);
