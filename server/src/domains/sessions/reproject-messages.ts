import type { Database } from 'better-sqlite3';
import { newId } from '../../utils/uuid.js';
import { SqliteSessionStorage } from '../../infra/providers/pi-runtime/session-tree/sqlite-session-storage.js';
import {
  projectEntriesToMessageRows,
  type ProjectedMessageRow,
} from '../../infra/providers/pi-runtime/session-tree/message-projection.js';
import {
  extractAndIndexMetadata,
  removeIndexedMetadata,
} from '../../infra/storage/metadata-extractor.js';

/** Async, pre-transaction: read the active path (root → leaf) and project it to message rows. */
export async function readActivePathRows(
  db: Database,
  sessionId: string
): Promise<ProjectedMessageRow[]> {
  const storage = new SqliteSessionStorage(db, sessionId);
  return projectEntriesToMessageRows(await storage.getActivePath());
}

/**
 * Sync, in-transaction: clear the session's existing projection + its derived
 * index entries, then insert the projected rows with sequential offsets and the
 * tree_entry_id back-link. Safe for both fork (empty target → delete is a no-op)
 * and branch (rewrite). Caller wraps this in db.transaction().
 */
export function writeProjectedMessages(
  db: Database,
  sessionId: string,
  rows: ProjectedMessageRow[]
): void {
  const existing = db
    .prepare(`SELECT id FROM messages WHERE session_id = ?`)
    .all(sessionId) as Array<{ id: string }>;
  for (const r of existing) removeIndexedMetadata(db, r.id);
  db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(sessionId);

  const insert = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, metadata, created_at, offset, tree_entry_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const baseNow = Date.now();
  let prevCreatedAt = -Infinity;
  rows.forEach((row, i) => {
    // Preserve each message's original time, but guarantee created_at strictly
    // increases along the path (root → leaf). A fork/branch projects the whole
    // path in one tick; without this every row would share one created_at and the
    // UI's created_at-ordered initial load would scramble the message order.
    const parsed = row.timestamp ? Date.parse(row.timestamp) : NaN;
    let createdAt = Number.isFinite(parsed) ? parsed : baseNow + i;
    if (createdAt <= prevCreatedAt) createdAt = prevCreatedAt + 1;
    prevCreatedAt = createdAt;

    const id = newId();
    const metadataJson = row.metadata ? JSON.stringify(row.metadata) : null;
    insert.run(id, sessionId, row.role, row.content, metadataJson, createdAt, i + 1, row.entryId);
    if (row.metadata) {
      const rowid = (
        db.prepare(`SELECT rowid FROM messages WHERE id = ?`).get(id) as
          | { rowid: number }
          | undefined
      )?.rowid;
      if (rowid != null) {
        extractAndIndexMetadata(
          db,
          id,
          rowid,
          sessionId,
          row.metadata as Parameters<typeof extractAndIndexMetadata>[4],
          createdAt
        );
      }
    }
  });
}
