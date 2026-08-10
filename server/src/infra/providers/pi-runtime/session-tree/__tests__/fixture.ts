import Database from 'better-sqlite3';
import { migration as sessionLogMigration } from '../../../../storage/migrations/040_session_log.js';

/**
 * A database with just enough schema for the session tree.
 *
 * `sessions` is a stand-in rather than the real table: that one sits behind
 * foreign keys to a project and an agent profile, and seeding those has
 * nothing to do with what these tests check. The session-tree schema itself
 * comes from the real migration so the tests exercise the shipped DDL.
 */
/**
 * Append a mutation to a session's log, allocating the next sequence number.
 *
 * Tests that build a specific tree shape need to set `parentId` freely, which
 * `appendEntry` deliberately does not allow — it chains to the lane leaf. This
 * writes the same rows the storage would, so the reader still replays a real
 * log rather than a hand-built object graph.
 */
function appendMutation(
  db: Database.Database,
  sessionId: string,
  mutation: (seq: number) => { kind: string; [key: string]: unknown }
): void {
  const row = db
    .prepare('SELECT COALESCE(MAX(seq), 0) AS max FROM session_log WHERE session_id = ?')
    .get(sessionId) as { max: number };
  const seq = row.max + 1;
  const payload = mutation(seq);
  db.prepare('INSERT INTO session_log (session_id, seq, kind, payload) VALUES (?, ?, ?, ?)').run(
    sessionId,
    seq,
    payload.kind,
    JSON.stringify(payload)
  );
}

/** Seed one entry at an explicit position in the tree. */
export function seedEntry(
  db: Database.Database,
  sessionId: string,
  entry: { id: string; parentId: string | null; type: string; timestamp?: number } & Record<
    string,
    unknown
  >
): void {
  appendMutation(db, sessionId, seq => ({
    kind: 'entry',
    entry: { timestamp: 1_700_000_000_000, ...entry, seq },
  }));
}

/** Point a session's lane at an entry (or at nothing). */
export function seedLane(
  db: Database.Database,
  sessionId: string,
  leafId: string | null,
  lane = 'main'
): void {
  appendMutation(db, sessionId, seq => ({ kind: 'lane', seq, lane, leafId }));
}

export function makeSessionDb(sessionId = 's1', createdAt = 1000): Database.Database {
  const db = new Database(':memory:');
  db.exec(
    `CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, parent_session_id TEXT);`
  );
  db.prepare('INSERT INTO sessions (id, created_at) VALUES (?, ?)').run(sessionId, createdAt);
  db.exec(sessionLogMigration.sql);
  return db;
}
