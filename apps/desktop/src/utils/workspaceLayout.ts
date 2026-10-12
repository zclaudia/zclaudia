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
  /** Adopted project anchors outlive their original/last chat and bypass the legacy LRU cache. */
  durable?: boolean;
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
    return keep({ toolId: root.accepts === 'chat' ? CHAT_TOOL_ID : root.accepts.slice(5) })
      ? root
      : null;
  }
  if (root.kind === 'pane') {
    const tools = root.tools.filter(keep);
    if (!tools.length) return null;
    if (tools.length === root.tools.length) return root;
    const active =
      tools.find(t => sameRef(t, root.activeToolId, root.activeInstanceKey)) ?? tools[0];
    return { ...root, tools, activeToolId: active.toolId, activeInstanceKey: active.instanceKey };
  }
  const a = pruneRefs(root.children[0], keep);
  const b = pruneRefs(root.children[1], keep);
  if (!a) return b;
  if (!b) return a;
  return a === root.children[0] && b === root.children[1] ? root : { ...root, children: [a, b] };
}

/** Remove chat refs for the legacy, tools-only workspace. */
export const pruneChat = (root: LayoutNode | null): LayoutNode | null =>
  pruneRefs(root, ref => !isChatRef(ref));

/** Chat-only geometry for collapsed tools; this is not a content mount list. */
export const pruneTools = (root: LayoutNode | null): LayoutNode | null =>
  pruneRefs(root, isChatRef);

export function withChat(
  root: LayoutNode | null,
  sessionId: string,
  ratio = DEFAULT_RATIO
): LayoutNode {
  if (
    root &&
    flattenPanes(root).some(p => p.tools.some(t => sameRef(t, CHAT_TOOL_ID, sessionId)))
  ) {
    return root;
  }
  const chat = newPane(CHAT_TOOL_ID, sessionId);
  if (!root) return chat;
  return {
    id: genId('grp'),
    kind: 'group',
    dir: 'row',
    ratio: clampRatio(Number.isFinite(ratio) ? ratio : DEFAULT_RATIO),
    children: [chat, root],
  };
}

/** Repair metadata without consulting feature flags or changing layout geometry. */
export function repairWorkspace(ws: SessionWorkspace): SessionWorkspace {
  const panes = flattenPanes(ws.root);
  const tools = panes.filter(p => !isPinnedPane(p));
  const primary = tools.some(p => p.id === ws.primaryPaneId)
    ? ws.primaryPaneId
    : (tools[0]?.id ?? null);
  const focused = panes.some(p => p.id === ws.focusedPaneId)
    ? ws.focusedPaneId
    : (tools[0]?.id ?? panes[0]?.id ?? null);
  const maximized =
    ws.maximizedPaneId && panes.some(p => p.id === ws.maximizedPaneId) ? ws.maximizedPaneId : null;
  if (
    primary === ws.primaryPaneId &&
    focused === ws.focusedPaneId &&
    (ws.maximizedPaneId === undefined || maximized === ws.maximizedPaneId)
  )
    return ws;
  return {
    ...ws,
    primaryPaneId: primary,
    focusedPaneId: focused,
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
  if (root.kind !== 'group' || !Number.isFinite(ratio)) return root;
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

export function isWorkspaceSlotKind(value: unknown): value is WorkspaceSlotKind {
  return (
    typeof value === 'string' &&
    (value === 'chat' || (value.startsWith('tool:') && value.length > 5 && value !== 'tool:chat'))
  );
}

export function isToolRef(value: unknown): value is ToolRef {
  if (!value || typeof value !== 'object') return false;
  const ref = value as ToolRef;
  return (
    typeof ref.toolId === 'string' &&
    ref.toolId.length > 0 &&
    (ref.instanceKey === undefined || typeof ref.instanceKey === 'string') &&
    (!isChatRef(ref) || (typeof ref.instanceKey === 'string' && ref.instanceKey.length > 0))
  );
}

/** Validate both the shape and the identities consumed by React content hosts. */
export function isSafeTree(node: unknown): node is LayoutNode {
  const ids = new Set<string>();
  const refs = new Set<string>();
  const slots = new Set<string>();
  const visit = (value: unknown, depth: number): boolean => {
    if (!value || typeof value !== 'object' || depth > 128) return false;
    const n = value as LayoutNode;
    if (typeof n.id !== 'string' || !n.id || ids.has(n.id)) return false;
    ids.add(n.id);
    if (n.kind === 'placeholder') {
      if (
        typeof n.slotId !== 'string' ||
        !n.slotId ||
        slots.has(n.slotId) ||
        !isWorkspaceSlotKind(n.accepts)
      )
        return false;
      slots.add(n.slotId);
      return true;
    }
    if (n.kind === 'pane') {
      if (
        !Array.isArray(n.tools) ||
        !n.tools.length ||
        !n.tools.every(isToolRef) ||
        typeof n.activeToolId !== 'string' ||
        !n.activeToolId ||
        (n.activeInstanceKey !== undefined && typeof n.activeInstanceKey !== 'string') ||
        !n.tools.some(ref => sameRef(ref, n.activeToolId, n.activeInstanceKey))
      )
        return false;
      const chat = isChatRef(n.tools[0]);
      return n.tools.every(ref => {
        const key = workspaceRefKey(ref);
        if (isChatRef(ref) !== chat || refs.has(key)) return false;
        refs.add(key);
        return true;
      });
    }
    return (
      n.kind === 'group' &&
      (n.dir === 'row' || n.dir === 'col') &&
      Number.isFinite(n.ratio) &&
      n.ratio >= MIN_RATIO &&
      n.ratio <= MAX_RATIO &&
      Array.isArray(n.children) &&
      n.children.length === 2 &&
      n.children.every(child => visit(child, depth + 1))
    );
  };
  return visit(node, 0);
}

/**
 * Recover usable siblings and refs independently. A malformed leaf must never
 * erase the other chats or tools in a persisted project workspace. First refs
 * win duplicate identities; distinct multi-instance scopes are retained.
 */
export function restoreLayoutTree(
  value: unknown,
  multiInstanceTools: ReadonlySet<string>
): LayoutNode | null {
  const objects = new WeakSet<object>();
  const ids = new Set<string>();
  const refs = new Set<string>();
  const slots = new Set<string>();
  let recovered = 0;
  const unique = (value: unknown, seen: Set<string>, prefix: string): string => {
    const base = typeof value === 'string' && value ? value : `${prefix}-${++recovered}`;
    let id = base;
    let suffix = 0;
    while (seen.has(id)) id = `${base}-recovered-${++suffix}`;
    seen.add(id);
    return id;
  };
  const visit = (value: unknown, depth: number): LayoutNode | null => {
    if (!value || typeof value !== 'object' || objects.has(value) || depth > 128) return null;
    objects.add(value);
    const node = value as LayoutNode;
    if (node.kind === 'placeholder') {
      if (!isWorkspaceSlotKind(node.accepts)) return null;
      const id = unique(node.id, ids, 'recovered-placeholder');
      const slotId = unique(node.slotId, slots, `recovered-slot-${id}`);
      return id === node.id && slotId === node.slotId ? node : { ...node, id, slotId };
    }
    if (node.kind === 'pane') {
      if (!Array.isArray(node.tools)) return null;
      const tools = node.tools.filter(ref => {
        if (!isToolRef(ref)) return false;
        const key =
          isChatRef(ref) || multiInstanceTools.has(ref.toolId)
            ? workspaceRefKey(ref)
            : JSON.stringify([ref.toolId]);
        if (refs.has(key)) return false;
        refs.add(key);
        return true;
      });
      if (!tools.length) return null;
      const id = unique(node.id, ids, 'recovered-pane');
      const pane = (id: string, tools: ToolRef[]): PaneNode => {
        const active =
          tools.find(ref => sameRef(ref, node.activeToolId, node.activeInstanceKey)) ?? tools[0];
        return {
          ...node,
          id,
          tools,
          activeToolId: active.toolId,
          activeInstanceKey: active.instanceKey,
        };
      };
      const chats = tools.filter(isChatRef);
      const others = tools.filter(ref => !isChatRef(ref));
      if (chats.length && others.length) {
        return {
          id: unique(`${id}-recovered-group`, ids, 'recovered-group'),
          kind: 'group',
          dir: 'row',
          ratio: DEFAULT_RATIO,
          children: [
            pane(id, chats),
            pane(unique(`${id}-recovered-tools`, ids, 'recovered-pane'), others),
          ],
        };
      }
      const next = pane(id, tools);
      return id === node.id &&
        tools.length === node.tools.length &&
        next.activeToolId === node.activeToolId &&
        next.activeInstanceKey === node.activeInstanceKey
        ? node
        : next;
    }
    if (node.kind !== 'group' || !Array.isArray(node.children)) return null;
    const id = unique(node.id, ids, 'recovered-group');
    const children = node.children
      .map(child => visit(child, depth + 1))
      .filter((child): child is LayoutNode => child !== null);
    if (!children.length) return null;
    if (children.length === 1) return children[0];
    const dir = node.dir === 'col' ? 'col' : 'row';
    const ratio = Number.isFinite(node.ratio) ? clampRatio(node.ratio) : DEFAULT_RATIO;
    if (
      id === node.id &&
      dir === node.dir &&
      ratio === node.ratio &&
      children.length === 2 &&
      children.every((child, index) => child === node.children[index])
    )
      return node;
    return children.slice(1).reduce<LayoutNode>(
      (a, b, index) => ({
        id: index === 0 ? id : unique(`${id}-recovered-group-${index}`, ids, 'recovered-group'),
        kind: 'group',
        dir,
        ratio,
        children: [a, b],
      }),
      children[0]
    );
  };
  return visit(value, 0);
}

export function isSplitWorkspace(root: LayoutNode | null): boolean {
  return !!root && root.kind === 'group';
}

/** JSON tuples distinguish complete ref identities without delimiter collisions. */
export const workspaceRefKey = (ref: ToolRef): string =>
  JSON.stringify([ref.toolId, ref.instanceKey ?? null]);

/** Authoritative deletion bypasses the UI's last-chat protection and preserves every other ref. */
export function removeChatSession(root: LayoutNode | null, sessionId: string): LayoutNode | null {
  return pruneRefs(root, ref => !isChatRef(ref) || ref.instanceKey !== sessionId);
}
