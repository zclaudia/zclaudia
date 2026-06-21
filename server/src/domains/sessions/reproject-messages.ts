import type { Database } from 'better-sqlite3';
import { newId } from '../../utils/uuid.js';
import { SqliteSessionStorage } from '../../infra/providers/pi-runtime/session-tree/sqlite-session-storage.js';
import { projectEntriesToMessageRows, type ProjectedMessageRow } from '../../infra/providers/pi-runtime/session-tree/message-projection.js';
import { extractAndIndexMetadata, removeIndexedMetadata } from '../../infra/storage/metadata-extractor.js';

/** Async, pre-transaction: read the active path (root → leaf) and project it to message rows. */
export async function readActivePathRows(db: Database, sessionId: string): Promise<ProjectedMessageRow[]> {
  const storage = new SqliteSessionStorage(db, sessionId);
  const leafId = await storage.getLeafId();
  const path = leafId ? await storage.getPathToRoot(leafId) : [];
  return projectEntriesToMessageRows(path);
}

/**
 * Sync, in-transaction: clear the session's existing projection + its derived
 * index entries, then insert the projected rows with sequential offsets and the
 * tree_entry_id back-link. Safe for both fork (empty target → delete is a no-op)
 * and branch (rewrite). Caller wraps this in db.transaction().
 */
export function writeProjectedMessages(db: Database, sessionId: string, rows: ProjectedMessageRow[]): void {
  const existing = db.prepare(`SELECT id FROM messages WHERE session_id = ?`).all(sessionId) as Array<{ id: string }>;
  for (const r of existing) removeIndexedMetadata(db, r.id);
  db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(sessionId);

  const insert = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, metadata, created_at, offset, tree_entry_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = Date.now();
  rows.forEach((row, i) => {
    const id = newId();
    const metadataJson = row.metadata ? JSON.stringify(row.metadata) : null;
    insert.run(id, sessionId, row.role, row.content, metadataJson, now, i + 1, row.entryId);
    if (row.metadata) {
      const rowid = (db.prepare(`SELECT rowid FROM messages WHERE id = ?`).get(id) as { rowid: number } | undefined)?.rowid;
      if (rowid != null) {
        extractAndIndexMetadata(db, id, rowid, sessionId, row.metadata as Parameters<typeof extractAndIndexMetadata>[4], now);
      }
    }
  });
}
