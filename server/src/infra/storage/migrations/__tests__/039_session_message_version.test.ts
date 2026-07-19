import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migration } from '../039_session_message_version.js';
import { migrations } from '../index.js';

describe('migration 039_session_message_version', () => {
  it('backfills and advances the revision for same-offset message mutations', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        offset INTEGER
      );
      INSERT INTO sessions (id, updated_at) VALUES ('session-1', 1);
      INSERT INTO messages (id, session_id, content, offset)
      VALUES ('message-1', 'session-1', 'partial', 1);
    `);

    db.exec(migration.sql);
    const version = () =>
      (
        db
          .prepare('SELECT message_version as value FROM sessions WHERE id = ?')
          .get('session-1') as { value: number }
      ).value;

    expect(version()).toBe(1);
    db.prepare(`INSERT INTO messages (id, session_id, content, offset) VALUES (?, ?, ?, ?)`).run(
      'message-2',
      'session-1',
      'new',
      2
    );
    expect(version()).toBe(2);

    db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(
      'complete body at the same offset',
      'message-2'
    );
    expect(version()).toBe(3);

    db.prepare('DELETE FROM messages WHERE id = ?').run('message-2');
    expect(version()).toBe(4);
    db.close();
  });

  it('is registered after migration 038', () => {
    const names = migrations.map(item => item.name);
    expect(names.indexOf('039_session_message_version')).toBe(
      names.indexOf('038_agent_profile_status') + 1
    );
  });
});
