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
export function makeSessionDb(sessionId = 's1', createdAt = 1000): Database.Database {
  const db = new Database(':memory:');
  db.exec(
    `CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, parent_session_id TEXT);`
  );
  db.prepare('INSERT INTO sessions (id, created_at) VALUES (?, ?)').run(sessionId, createdAt);
  db.exec(sessionLogMigration.sql);
  return db;
}
