import type { Database } from 'better-sqlite3';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

interface ScanRow {
  type: string;
  payload: string;
}

/**
 * Read up to `messageLimit` most-recent message entries from the active branch,
 * newest last (root→leaf order). Unlike `buildContext`, this caps the tree walk
 * (`p.depth < scanCap`) so a long session doesn't reconstruct the whole branch
 * for a throwaway recent window — e.g. session-title generation. Compaction
 * boundaries are NOT applied; callers that only need recent raw text (titles)
 * don't care, and the cap keeps the read O(scanCap) instead of O(branch).
 */
export function readRecentMessages(db: Database, sessionId: string, messageLimit: number): AgentMessage[] {
  const leafRow = db.prepare('SELECT leaf_id AS leafId FROM session_leaf WHERE session_id = ?')
    .get(sessionId) as { leafId: string | null } | undefined;
  const leafId = leafRow?.leafId ?? null;
  if (!leafId) return [];

  // Generous over-read so tool-heavy turns (assistant + many toolResults) still
  // yield `messageLimit` message entries, while staying bounded for long sessions.
  const scanCap = Math.max(messageLimit * 6, 64);
  const rows = db.prepare(
    `WITH RECURSIVE path(id, parent_id, type, payload, depth) AS (
       SELECT id, parent_id, type, payload, 0
         FROM session_entries WHERE id = ? AND session_id = ?
       UNION ALL
       SELECT e.id, e.parent_id, e.type, e.payload, p.depth + 1
         FROM session_entries e JOIN path p ON e.id = p.parent_id
         WHERE e.session_id = ? AND p.depth < ?
     )
     SELECT type, payload FROM path ORDER BY depth DESC`,
  ).all(leafId, sessionId, sessionId, scanCap) as ScanRow[];

  const messages = rows
    .filter((r) => r.type === 'message')
    .map((r) => (JSON.parse(r.payload) as { message: AgentMessage }).message);
  return messages.slice(-messageLimit);
}
