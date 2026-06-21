import type { Database } from 'better-sqlite3';
import type { GraphNode } from '@zclaudia/shared/core/context-graph';

interface EntryRow { id: string; parent_id: string | null; type: string; payload: string; timestamp: string; }

const NODE_ENTRY_TYPES = new Set(['message', 'compaction', 'label', 'leaf']);

function nodeEntryType(raw: string): GraphNode['entryType'] {
  return (NODE_ENTRY_TYPES.has(raw) ? raw : 'message') as GraphNode['entryType'];
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
export function buildSessionSubgraph(db: Database, sessionId: string, opts: SubgraphOptions): { nodes: GraphNode[]; truncated: boolean } {
  const rawRows = db.prepare(
    `SELECT id, parent_id, type, payload, timestamp FROM session_entries WHERE session_id = ? ORDER BY rowid LIMIT ?`,
  ).all(sessionId, opts.nodeCap + 1) as EntryRow[];
  const truncated = rawRows.length > opts.nodeCap;
  const rows = truncated ? rawRows.slice(0, opts.nodeCap) : rawRows;
  if (rows.length === 0) return { nodes: [], truncated };

  const leafId = (db.prepare(`SELECT leaf_id AS l FROM session_leaf WHERE session_id = ?`).get(sessionId) as { l: string | null } | undefined)?.l ?? null;

  const byId = new Map<string, EntryRow>();
  const parentOf = new Map<string, string | null>();
  const childCount = new Map<string, number>();
  const role = new Map<string, string | undefined>();
  for (const r of rows) {
    byId.set(r.id, r);
    parentOf.set(r.id, r.parent_id);
    if (r.parent_id) childCount.set(r.parent_id, (childCount.get(r.parent_id) ?? 0) + 1);
    if (r.type === 'message') {
      try { role.set(r.id, JSON.parse(r.payload)?.message?.role as string | undefined); } catch { role.set(r.id, undefined); }
    }
  }

  const activePath = new Set<string>();
  if (leafId && byId.has(leafId)) {
    let cur: string | null = leafId;
    while (cur && byId.has(cur) && !activePath.has(cur)) { activePath.add(cur); cur = parentOf.get(cur) ?? null; }
  }

  const msgByEntry = new Map<string, string>();
  for (const m of db.prepare(`SELECT id, tree_entry_id AS t FROM messages WHERE session_id = ? AND tree_entry_id IS NOT NULL`).all(sessionId) as Array<{ id: string; t: string }>) {
    msgByEntry.set(m.t, m.id);
  }

  const isStructural = (id: string): boolean => {
    const r = byId.get(id)!;
    return (
      r.parent_id === null ||
      (childCount.get(id) ?? 0) >= 2 ||
      (childCount.get(id) ?? 0) === 0 ||
      r.type === 'compaction' || r.type === 'label' || r.type === 'leaf' ||
      id === leafId ||
      opts.forkPointEntryIds.has(id) ||
      id === opts.forkBaseEntryId
    );
  };

  const nid = (id: string) => `${sessionId}:${id}`;
  const nodes: GraphNode[] = [];

  for (const r of rows) {
    if (!isStructural(r.id)) continue;
    let payload: any = {};
    try { payload = JSON.parse(r.payload); } catch { /* leave {} */ }

    let parentNodeId: string | null = null;
    let count = 0;
    {
      let cur = parentOf.get(r.id) ?? null;
      const seen = new Set<string>();
      while (cur && byId.has(cur) && !seen.has(cur)) {
        seen.add(cur);
        if (isStructural(cur)) { parentNodeId = nid(cur); break; }
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
        if (m) { messageId = m; break; }
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
      node.compaction = {
        summary: payload.summary ?? '',
        tokensBefore: payload.tokensBefore ?? 0,
        source: (payload.details?.source ?? 'auto') as 'auto' | 'manual' | 'overflow' | 'preflight',
      };
    }
    if (r.type === 'label') {
      node.label = payload.label ?? '';
      if (payload.targetId) node.labelTargetNodeId = nid(payload.targetId);
    }
    nodes.push(node);
  }

  return { nodes, truncated };
}
