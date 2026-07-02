import type { Database } from 'better-sqlite3';
import type {
  ContextGraph,
  SessionLane,
  ForkEdge,
  GraphNode,
} from '@zclaudia/shared/core/context-graph';

interface EntryRow {
  id: string;
  parent_id: string | null;
  type: string;
  payload: string;
  timestamp: string;
}

const NODE_ENTRY_TYPES = new Set(['message', 'compaction', 'label', 'leaf']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nodeEntryType(raw: string): GraphNode['entryType'] {
  return (NODE_ENTRY_TYPES.has(raw) ? raw : 'message') as GraphNode['entryType'];
}

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function compactionSource(value: unknown): 'auto' | 'manual' | 'overflow' | 'preflight' {
  return value === 'manual' || value === 'overflow' || value === 'preflight' ? value : 'auto';
}

export interface SubgraphOptions {
  /** This session's own fork_entry_id (where it diverged from its parent), or null. Always made structural. */
  forkBaseEntryId: string | null;
  /** Entry ids in THIS session that are fork sources (referenced by a child's forkEntryId). */
  forkPointEntryIds: Set<string>;
  /** Per-session entry cap; entries beyond it are dropped and `truncated` is set. */
  nodeCap: number;
}

/**
 * Build one session's structural GraphNode[] from a synchronous, in-memory parent
 * map (no recursive CTE — cycle-safe + node-capped). Pure read.
 */
export function buildSessionSubgraph(
  db: Database,
  sessionId: string,
  opts: SubgraphOptions
): { nodes: GraphNode[]; truncated: boolean } {
  // Truncation is first-N-by-insertion-order (rowid), NOT a connected prefix: under
  // truncation a kept entry may reference a dropped parent/fork entry. That is handled
  // downstream by the dangling parentNodeId / fork-edge filters in buildContextGraph.
  const rawRows = db
    .prepare(
      `SELECT id, parent_id, type, payload, timestamp FROM session_entries WHERE session_id = ? ORDER BY rowid LIMIT ?`
    )
    .all(sessionId, opts.nodeCap + 1) as EntryRow[];
  const truncated = rawRows.length > opts.nodeCap;
  const rows = truncated ? rawRows.slice(0, opts.nodeCap) : rawRows;
  if (rows.length === 0) return { nodes: [], truncated };

  const leafId =
    (
      db.prepare(`SELECT leaf_id AS l FROM session_leaf WHERE session_id = ?`).get(sessionId) as
        | { l: string | null }
        | undefined
    )?.l ?? null;

  const byId = new Map<string, EntryRow>();
  const parentOf = new Map<string, string | null>();
  const childCount = new Map<string, number>();
  const role = new Map<string, string | undefined>();
  for (const r of rows) {
    byId.set(r.id, r);
    parentOf.set(r.id, r.parent_id);
    if (r.parent_id) childCount.set(r.parent_id, (childCount.get(r.parent_id) ?? 0) + 1);
    if (r.type === 'message') {
      try {
        role.set(r.id, JSON.parse(r.payload)?.message?.role as string | undefined);
      } catch {
        role.set(r.id, undefined);
      }
    }
  }

  const activePath = new Set<string>();
  if (leafId && byId.has(leafId)) {
    let cur: string | null = leafId;
    while (cur && byId.has(cur) && !activePath.has(cur)) {
      activePath.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
  }

  const msgByEntry = new Map<string, string>();
  for (const m of db
    .prepare(
      `SELECT id, tree_entry_id AS t FROM messages WHERE session_id = ? AND tree_entry_id IS NOT NULL`
    )
    .all(sessionId) as Array<{ id: string; t: string }>) {
    msgByEntry.set(m.t, m.id);
  }

  const isStructural = (id: string): boolean => {
    const r = byId.get(id);
    if (!r) return false;
    return (
      r.parent_id === null ||
      (childCount.get(id) ?? 0) >= 2 ||
      (childCount.get(id) ?? 0) === 0 ||
      r.type === 'compaction' ||
      r.type === 'label' ||
      r.type === 'leaf' ||
      id === leafId ||
      opts.forkPointEntryIds.has(id) ||
      id === opts.forkBaseEntryId
    );
  };

  const nid = (id: string) => `${sessionId}:${id}`;
  const nodes: GraphNode[] = [];

  for (const r of rows) {
    if (!isStructural(r.id)) continue;
    const payload = parsePayload(r.payload);

    let parentNodeId: string | null = null;
    let count = 0;
    {
      let cur = parentOf.get(r.id) ?? null;
      const seen = new Set<string>();
      while (cur && byId.has(cur) && !seen.has(cur)) {
        seen.add(cur);
        if (isStructural(cur)) {
          parentNodeId = nid(cur);
          break;
        }
        const rl = role.get(cur);
        if (rl === 'user' || rl === 'assistant') count++;
        cur = parentOf.get(cur) ?? null;
      }
    }

    let messageId: string | null = null;
    {
      let cur: string | null = r.id;
      const seen = new Set<string>();
      while (cur && byId.has(cur) && !seen.has(cur)) {
        seen.add(cur);
        const m = msgByEntry.get(cur);
        if (m) {
          messageId = m;
          break;
        }
        cur = parentOf.get(cur) ?? null;
      }
    }

    const node: GraphNode = {
      nodeId: nid(r.id),
      sessionId,
      entryId: r.id,
      entryType: nodeEntryType(r.type),
      isRoot: r.parent_id === null,
      isBranchPoint: (childCount.get(r.id) ?? 0) >= 2,
      isForkPoint: opts.forkPointEntryIds.has(r.id),
      isForkBase: r.id === opts.forkBaseEntryId,
      isActiveLeaf: r.id === leafId,
      isBranchTip: (childCount.get(r.id) ?? 0) === 0 && r.id !== leafId,
      onActivePath: activePath.has(r.id),
      parentNodeId,
      incomingMessageCount: count,
      timestamp: r.timestamp,
      jump: { messageId, compactionId: r.type === 'compaction' ? r.id : null },
    };
    if (r.type === 'compaction') {
      const details = isRecord(payload.details) ? payload.details : {};
      node.compaction = {
        summary: typeof payload.summary === 'string' ? payload.summary : '',
        tokensBefore: typeof payload.tokensBefore === 'number' ? payload.tokensBefore : 0,
        source: compactionSource(details.source),
      };
    }
    if (r.type === 'label') {
      node.label = typeof payload.label === 'string' ? payload.label : '';
      if (typeof payload.targetId === 'string') node.labelTargetNodeId = nid(payload.targetId);
    }
    nodes.push(node);
  }

  return { nodes, truncated };
}

const TOTAL_NODE_CAP = 2000;

interface SessionRow {
  id: string;
  name: string | null;
  forked_from_session_id: string | null;
  fork_entry_id: string | null;
  created_at: number;
  archived_at: number | null;
}

/**
 * Build the whole fork family's context graph for any member session. Synchronous,
 * direct-SQL, pure read. Returns null if the session does not exist.
 */
export function buildContextGraph(db: Database, sessionId: string): ContextGraph | null {
  const focus = db.prepare(`SELECT project_id AS p FROM sessions WHERE id = ?`).get(sessionId) as
    | { p: string }
    | undefined;
  if (!focus) return null;

  const all = db
    .prepare(
      `SELECT id, name, forked_from_session_id, fork_entry_id, created_at, archived_at FROM sessions WHERE project_id = ?`
    )
    .all(focus.p) as SessionRow[];
  const byId = new Map(all.map(s => [s.id, s]));
  const parentInProject = (s: SessionRow): string | null =>
    s.forked_from_session_id && byId.has(s.forked_from_session_id)
      ? s.forked_from_session_id
      : null;

  const childrenOf = new Map<string, SessionRow[]>();
  for (const s of all) {
    const p = parentInProject(s);
    if (p) {
      const arr = childrenOf.get(p) ?? [];
      arr.push(s);
      childrenOf.set(p, arr);
    }
  }

  let rootId = sessionId;
  {
    const seen = new Set<string>();
    let cur: string | null = sessionId;
    while (cur && byId.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      rootId = cur;
      const row = byId.get(cur);
      if (!row) break;
      cur = parentInProject(row);
    }
  }

  const familyIds = new Set<string>();
  {
    const queue = [rootId];
    while (queue.length) {
      const id = queue.shift();
      if (!id) continue;
      if (familyIds.has(id)) continue;
      familyIds.add(id);
      for (const c of childrenOf.get(id) ?? []) queue.push(c.id);
    }
  }

  const lanes: SessionLane[] = [];
  {
    let order = 0;
    const queue: string[] = [rootId];
    const seen = new Set<string>();
    while (queue.length) {
      const id = queue.shift();
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      const s = byId.get(id);
      if (!s) continue;
      lanes.push({
        id: s.id,
        name: s.name,
        forkedFromSessionId: parentInProject(s),
        forkEntryId: parentInProject(s) ? s.fork_entry_id : null,
        createdAt: s.created_at,
        archived: s.archived_at != null,
        laneOrder: order++,
      });
      const kids = (childrenOf.get(id) ?? []).slice().sort((a, b) => a.created_at - b.created_at);
      for (const k of kids) queue.push(k.id);
    }
  }

  const forkSources = new Map<string, Set<string>>();
  for (const s of all) {
    const p = parentInProject(s);
    if (p && familyIds.has(p) && s.fork_entry_id) {
      const set = forkSources.get(p) ?? new Set<string>();
      set.add(s.fork_entry_id);
      forkSources.set(p, set);
    }
  }

  const nodes: GraphNode[] = [];
  let truncated = false;
  let remaining = TOTAL_NODE_CAP;
  for (const lane of lanes) {
    const s = byId.get(lane.id);
    if (!s) continue;
    const sub = buildSessionSubgraph(db, lane.id, {
      forkBaseEntryId: parentInProject(s) ? s.fork_entry_id : null,
      forkPointEntryIds: forkSources.get(lane.id) ?? new Set<string>(),
      nodeCap: Math.max(0, remaining),
    });
    truncated = truncated || sub.truncated;
    remaining -= sub.nodes.length;
    nodes.push(...sub.nodes);
  }

  const nodeIds = new Set(nodes.map(n => n.nodeId));
  const forkEdges: ForkEdge[] = [];
  for (const lane of lanes) {
    const s = byId.get(lane.id);
    if (!s) continue;
    const p = parentInProject(s);
    if (p && familyIds.has(p) && s.fork_entry_id) {
      const fromNodeId = `${p}:${s.fork_entry_id}`;
      const toNodeId = `${s.id}:${s.fork_entry_id}`;
      if (nodeIds.has(fromNodeId) && nodeIds.has(toNodeId))
        forkEdges.push({ fromNodeId, toSessionId: s.id, toNodeId });
    }
  }

  for (const n of nodes) {
    if (n.parentNodeId && !nodeIds.has(n.parentNodeId)) n.parentNodeId = null;
    if (n.labelTargetNodeId && !nodeIds.has(n.labelTargetNodeId)) n.labelTargetNodeId = undefined;
  }

  return {
    rootSessionId: rootId,
    focusSessionId: sessionId,
    sessions: lanes,
    nodes,
    forkEdges,
    truncated,
  };
}
