import type { Database } from 'better-sqlite3';
import { SessionError } from '@earendil-works/pi-agent-core';

interface PathRow {
  id: string;
  parent_id: string | null;
  type: string;
  payload: string;
  timestamp: string;
}

/**
 * Fork "at": copy the source session's root→entryId path (inclusive) into a
 * NEW session, preserving parent links and entry ids, and set the new session's
 * leaf to the fork-point entry. Entry ids are REUSED (the composite PK
 * (session_id, id) allows the same id under a new session) — required so that
 * intra-payload id references (compaction.firstKeptEntryId, branch_summary.fromId,
 * label.targetId) remain valid in the forked session. The source is untouched.
 *
 * Wrapped in a transaction so a partial copy can never leave a dangling tree.
 */
export function forkSessionAt(
  db: Database,
  sourceSessionId: string,
  entryId: string,
  newSessionId: string
): void {
  const tx = db.transaction(() => {
    const rows = db
      .prepare(
        `WITH RECURSIVE path(id, parent_id, type, payload, timestamp, depth) AS (
         SELECT id, parent_id, type, payload, timestamp, 0
           FROM session_entries WHERE id = ? AND session_id = ?
         UNION ALL
         SELECT e.id, e.parent_id, e.type, e.payload, e.timestamp, p.depth + 1
           FROM session_entries e JOIN path p ON e.id = p.parent_id
           WHERE e.session_id = ?
       )
       SELECT id, parent_id, type, payload, timestamp FROM path ORDER BY depth DESC`
      )
      .all(entryId, sourceSessionId, sourceSessionId) as PathRow[];
    if (rows.length === 0) {
      throw new SessionError(
        'invalid_fork_target',
        `fork target ${entryId} not found in session ${sourceSessionId}`
      );
    }
    const insert = db.prepare(
      `INSERT INTO session_entries (id, session_id, parent_id, type, payload, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const r of rows) {
      insert.run(r.id, newSessionId, r.parent_id, r.type, r.payload, r.timestamp);
    }
    db.prepare(
      `INSERT INTO session_leaf (session_id, leaf_id) VALUES (?, ?)
       ON CONFLICT(session_id) DO UPDATE SET leaf_id = excluded.leaf_id`
    ).run(newSessionId, entryId);
  });
  tx();
}
