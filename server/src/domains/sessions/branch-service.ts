import type { Database } from 'better-sqlite3';
import { SqliteSessionStorage } from '../../infra/providers/pi-runtime/session-tree/sqlite-session-storage.js';
import { readActivePathRows, writeProjectedMessages } from './reproject-messages.js';

export class BranchError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function entryBelongsToSession(db: Database, sessionId: string, entryId: string): boolean {
  return !!db
    .prepare(`SELECT 1 FROM session_entries WHERE id = ? AND session_id = ?`)
    .get(entryId, sessionId);
}

/**
 * Rewind: move the session's active leaf to `entryId` (any entry in the session)
 * and rewrite the messages projection to the new active path. The old tip remains
 * in session_entries as a sibling branch; it just leaves the linear UI view.
 */
export async function branchSessionAt(
  db: Database,
  sessionId: string,
  entryId: string
): Promise<{ sessionId: string; leafId: string }> {
  if (!db.prepare(`SELECT 1 FROM sessions WHERE id = ?`).get(sessionId)) {
    throw new BranchError(404, 'NOT_FOUND', `session not found: ${sessionId}`);
  }
  if (!entryBelongsToSession(db, sessionId, entryId)) {
    throw new BranchError(400, 'INVALID_ENTRY', `entry ${entryId} not in session ${sessionId}`);
  }

  const storage = new SqliteSessionStorage(db, sessionId);
  const currentLeaf = await storage.getLeafId();
  if (currentLeaf === entryId) {
    return { sessionId, leafId: entryId };
  }

  await storage.setLeafId(entryId);
  const rows = await readActivePathRows(db, sessionId);
  db.transaction(() => {
    writeProjectedMessages(db, sessionId, rows);
    db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(Date.now(), sessionId);
  })();

  return { sessionId, leafId: entryId };
}
