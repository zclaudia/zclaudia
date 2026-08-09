import type { Database } from 'better-sqlite3';
import { MAIN_LANE } from '../../infra/providers/pi-runtime/session-tree/session-state.js';
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

async function entryBelongsToSession(
  db: Database,
  sessionId: string,
  entryId: string
): Promise<boolean> {
  // Entries live inside the session's mutation log now, so ownership is a
  // question for the storage rather than a row lookup.
  return (await new SqliteSessionStorage(db, sessionId).getEntry(entryId)) !== undefined;
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
  if (!(await entryBelongsToSession(db, sessionId, entryId))) {
    throw new BranchError(400, 'INVALID_ENTRY', `entry ${entryId} not in session ${sessionId}`);
  }

  const storage = new SqliteSessionStorage(db, sessionId);
  const currentLeaf = await storage.getLeafId();
  if (currentLeaf === entryId) {
    return { sessionId, leafId: entryId };
  }

  // 0.84: the leaf pointer is a lane. Branching is moving the main lane's
  // cursor to the chosen entry.
  await storage.moveLane(MAIN_LANE, entryId);
  const rows = await readActivePathRows(db, sessionId);
  db.transaction(() => {
    writeProjectedMessages(db, sessionId, rows);
    db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(Date.now(), sessionId);
  })();

  return { sessionId, leafId: entryId };
}
