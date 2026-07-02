import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { Session } from '@earendil-works/pi-agent-core';
import type { MessageEntry } from '@earendil-works/pi-agent-core';
import { migration } from '../../../../storage/migrations/021_session_entries.js';
import { SqliteSessionStorage } from '../sqlite-session-storage.js';
import { forkSessionAt } from '../fork.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);`);
  db.exec(`INSERT INTO sessions (id, created_at) VALUES ('src', 1000), ('dst', 2000);`);
  db.exec(migration.sql);
  return db;
}
const msg = (role: 'user' | 'assistant', content: string) =>
  ({ role, content }) as MessageEntry['message'];

describe('forkSessionAt (position "at")', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
  });

  it('copies the path up to and including the entry into a new session, sets its leaf', async () => {
    const src = new Session(new SqliteSessionStorage(db, 'src'));
    await src.appendMessage(msg('user', 'a'));
    const forkPoint = await src.appendMessage(msg('assistant', 'b'));
    await src.appendMessage(msg('user', 'c-after-fork')); // must NOT be copied

    forkSessionAt(db, 'src', forkPoint, 'dst');

    const dst = new Session(new SqliteSessionStorage(db, 'dst'));
    const ctx = await dst.buildContext();
    expect(ctx.messages.map(m => (m as { content: string }).content)).toEqual(['a', 'b']);
  });

  it('leaves the source session untouched', async () => {
    const src = new Session(new SqliteSessionStorage(db, 'src'));
    await src.appendMessage(msg('user', 'a'));
    const forkPoint = await src.appendMessage(msg('assistant', 'b'));
    await src.appendMessage(msg('user', 'c'));

    forkSessionAt(db, 'src', forkPoint, 'dst');

    const ctx = await src.buildContext();
    expect(ctx.messages.map(m => (m as { content: string }).content)).toEqual(['a', 'b', 'c']);
  });

  it('throws for a non-existent fork target', () => {
    const db2 = makeDb();
    expect(() => forkSessionAt(db2, 'src', 'ghost', 'dst')).toThrow();
  });
});
