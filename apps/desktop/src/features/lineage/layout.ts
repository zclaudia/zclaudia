import type { ContextGraph, GraphNode } from '@zclaudia/shared';

export interface LayoutNode { nodeId: string; sessionId: string; x: number; y: number; node: GraphNode; archived: boolean; }
export interface LayoutEdge {
  id: string; kind: 'message' | 'fork';
  fromX: number; fromY: number; toX: number; toY: number;
  messageCount: number; dimmed: boolean;
}
export interface LayoutBadge { branchNodeId: string; x: number; y: number; count: number; }
export interface LayoutLaneLabel { sessionId: string; name: string | null; x: number; archived: boolean; }
export interface LayoutModel {
  nodes: LayoutNode[]; edges: LayoutEdge[]; badges: LayoutBadge[];
  laneLabels: LayoutLaneLabel[]; width: number; height: number; truncated: boolean;
}

export const LANE_GAP = 130;
export const SUBLANE_GAP = 26;
export const ROW_GAP = 56;
export const MARGIN_X = 44;
export const MARGIN_TOP = 36;
export const MAX_SUBLANES = 3;

export function computeLayout(graph: ContextGraph): LayoutModel {
  const nodeById = new Map(graph.nodes.map((n) => [n.nodeId, n]));
  const laneBySession = new Map(graph.sessions.map((s) => [s.id, s]));
  const baseX = (sessionId: string) => MARGIN_X + (laneBySession.get(sessionId)?.laneOrder ?? 0) * LANE_GAP;

  const childrenByParent = new Map<string, GraphNode[]>();
  for (const n of graph.nodes) {
    if (!n.parentNodeId) continue;
    const arr = childrenByParent.get(n.parentNodeId) ?? [];
    arr.push(n);
    childrenByParent.set(n.parentNodeId, arr);
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => (Number(b.onActivePath) - Number(a.onActivePath)) || a.timestamp.localeCompare(b.timestamp));
  }

  // nodes grouped by session (built once; avoids filter-in-loop).
  const nodesBySession = new Map<string, GraphNode[]>();
  for (const n of graph.nodes) {
    const arr = nodesBySession.get(n.sessionId) ?? [];
    arr.push(n);
    nodesBySession.set(n.sessionId, arr);
  }

  // Render roots for a session. Forked child → its forkBase only. Family root →
  // the isRoot node; if absent (truncated), EVERY node whose parent was cut away
  // becomes its own root so no subtree is silently dropped.
  const renderRootsOf = (sessionId: string): GraphNode[] => {
    const lane = laneBySession.get(sessionId);
    const inSession = nodesBySession.get(sessionId) ?? [];
    if (lane?.forkedFromSessionId && lane.forkEntryId) {
      const fb = inSession.find((n) => n.isForkBase) ?? inSession.find((n) => n.entryId === lane.forkEntryId);
      return fb ? [fb] : [];
    }
    const explicit = inSession.find((n) => n.isRoot);
    if (explicit) return [explicit];
    return inSession.filter((n) => !n.parentNodeId || !nodeById.has(n.parentNodeId));
  };

  const depthByNodeId = new Map<string, number>();
  const placed = new Map<string, LayoutNode>();
  const badges: LayoutBadge[] = [];

  const sessionsInOrder = [...graph.sessions].sort((a, b) => a.laneOrder - b.laneOrder);

  for (const lane of sessionsInOrder) {
    const roots = renderRootsOf(lane.id);
    if (roots.length === 0) continue;
    let nextSublane = 1; // monotonic per session → sub-lane x never collides

    roots.forEach((root, rootIdx) => {
      let rootDepth = 0;
      let rootSublane = 0;
      if (lane.forkedFromSessionId && lane.forkEntryId) {
        // If the parent fork point was truncated away it isn't placed yet, so this
        // misses and the child band silently starts at depth 0 (and the fork edge is
        // dropped below). Intentional safe degrade for truncated graphs.
        const parentForkNodeId = `${lane.forkedFromSessionId}:${lane.forkEntryId}`;
        rootDepth = depthByNodeId.get(parentForkNodeId) ?? 0;
      } else if (rootIdx > 0) {
        rootSublane = nextSublane++; // extra dangling root → its own dogleg column
      }

      const stack: Array<{ node: GraphNode; depth: number; sublane: number }> = [{ node: root, depth: rootDepth, sublane: rootSublane }];
      while (stack.length) {
        const { node, depth, sublane } = stack.pop()!;
        if (placed.has(node.nodeId)) continue;
        depthByNodeId.set(node.nodeId, depth);
        placed.set(node.nodeId, {
          nodeId: node.nodeId, sessionId: node.sessionId,
          x: baseX(lane.id) + sublane * SUBLANE_GAP, y: MARGIN_TOP + depth * ROW_GAP, node,
          archived: lane.archived,
        });
        const kids = childrenByParent.get(node.nodeId) ?? [];
        let doglegCount = 0; // per-branch-point cap (NOT cumulative across the session)
        let degraded = 0;
        const frames: Array<{ node: GraphNode; depth: number; sublane: number }> = [];
        kids.forEach((kid, i) => {
          if (i === 0) { frames.push({ node: kid, depth: depth + 1, sublane }); return; }
          doglegCount++;
          if (doglegCount >= MAX_SUBLANES) { degraded++; return; }
          frames.push({ node: kid, depth: depth + 1, sublane: nextSublane++ });
        });
        if (degraded > 0) {
          const self = placed.get(node.nodeId)!;
          badges.push({ branchNodeId: node.nodeId, x: self.x, y: self.y, count: degraded });
        }
        for (let i = frames.length - 1; i >= 0; i--) stack.push(frames[i]);
      }
    });
  }

  const edges: LayoutEdge[] = [];
  for (const ln of placed.values()) {
    const p = ln.node.parentNodeId ? placed.get(ln.node.parentNodeId) : undefined;
    if (p && p.sessionId === ln.sessionId) {
      const lane = laneBySession.get(ln.sessionId);
      edges.push({
        id: `m:${p.nodeId}->${ln.nodeId}`, kind: 'message',
        fromX: p.x, fromY: p.y, toX: ln.x, toY: ln.y,
        messageCount: ln.node.incomingMessageCount,
        dimmed: !ln.node.onActivePath || !!lane?.archived,
      });
    }
  }
  for (const fe of graph.forkEdges) {
    const from = placed.get(fe.fromNodeId);
    const to = placed.get(fe.toNodeId);
    if (!from || !to) continue;
    const childLane = laneBySession.get(fe.toSessionId);
    edges.push({
      id: `f:${fe.fromNodeId}->${fe.toNodeId}`, kind: 'fork',
      fromX: from.x, fromY: from.y, toX: to.x, toY: to.y,
      messageCount: 0, dimmed: !!childLane?.archived,
    });
  }

  const laneLabels: LayoutLaneLabel[] = sessionsInOrder.map((s) => ({
    sessionId: s.id, name: s.name, x: baseX(s.id), archived: s.archived,
  }));

  const nodes = [...placed.values()];
  const width = (nodes.length ? Math.max(...nodes.map((n) => n.x)) : MARGIN_X) + MARGIN_X;
  const height = (nodes.length ? Math.max(...nodes.map((n) => n.y)) : MARGIN_TOP) + ROW_GAP;
  return { nodes, edges, badges, laneLabels, width, height, truncated: graph.truncated };
}
