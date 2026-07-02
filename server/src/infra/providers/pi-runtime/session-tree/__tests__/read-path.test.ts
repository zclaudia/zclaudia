import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { migration } from '../../../../storage/migrations/021_session_entries.js';
import { appendMessagesToTree } from '../write-path.js';
import { readRecentMessages } from '../read-path.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);`);
  db.exec(`INSERT INTO sessions (id, created_at) VALUES ('s1', 1000);`);
  db.exec(migration.sql);
  return db;
}

const msg = (role: string, content: string) => ({ role, content }) as never;

describe('readRecentMessages', () => {
  it('returns [] for a session with no entries', () => {
    expect(readRecentMessages(makeDb(), 's1', 16)).toEqual([]);
  });

  it('returns all messages (in root→leaf order) when fewer than the limit', () => {
    const db = makeDb();
    appendMessagesToTree(db, 's1', [msg('user', 'a'), msg('assistant', 'b'), msg('user', 'c')]);
    const out = readRecentMessages(db, 's1', 16) as Array<{ role: string; content: string }>;
    expect(out.map(m => m.content)).toEqual(['a', 'b', 'c']);
  });

  it('returns only the most recent `limit` messages for a long session', () => {
    const db = makeDb();
    const many = Array.from({ length: 40 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`)
    );
    appendMessagesToTree(db, 's1', many);
    const out = readRecentMessages(db, 's1', 16) as Array<{ content: string }>;
    expect(out).toHaveLength(16);
    expect(out[0].content).toBe('m24'); // 40 - 16
    expect(out[15].content).toBe('m39');
  });
});
