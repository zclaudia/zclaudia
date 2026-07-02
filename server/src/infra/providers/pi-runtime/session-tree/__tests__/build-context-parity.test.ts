import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { Session } from '@earendil-works/pi-agent-core';
import type { MessageEntry } from '@earendil-works/pi-agent-core';
import { migration } from '../../../../storage/migrations/021_session_entries.js';
import { SqliteSessionStorage } from '../sqlite-session-storage.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);`);
  db.exec(`INSERT INTO sessions (id, created_at) VALUES ('s1', 1000);`);
  db.exec(migration.sql);
  return db;
}

function msg(role: 'user' | 'assistant', content: string): MessageEntry['message'] {
  return { role, content } as MessageEntry['message'];
}

describe('buildContext over SqliteSessionStorage', () => {
  let db: Database.Database;
  let storage: SqliteSessionStorage;
  beforeEach(() => {
    db = makeDb();
    storage = new SqliteSessionStorage(db, 's1');
  });

  it('rebuilds the root→leaf message path in order', async () => {
    const session = new Session(storage);
    const id1 = await session.appendMessage(msg('user', 'one'));
    const id2 = await session.appendMessage(msg('assistant', 'two'));
    await session.appendMessage(msg('user', 'three'));

    const ctx = await session.buildContext();
    expect(ctx.messages.map(m => (m as { content: string }).content)).toEqual([
      'one',
      'two',
      'three',
    ]);
    expect(id1).not.toEqual(id2);
  });

  it('drops pre-boundary messages and prepends the summary after compaction', async () => {
    const session = new Session(storage);
    await session.appendMessage(msg('user', 'old-1'));
    const keepId = await session.appendMessage(msg('user', 'kept-boundary'));
    await session.appendMessage(msg('assistant', 'after'));
    await session.appendCompaction('SUMMARY TEXT', keepId, 1234);

    const ctx = await session.buildContext();
    // The compaction-summary message uses role 'compactionSummary' with a `summary`
    // field; regular messages carry string `content`. Read whichever is present.
    const texts = ctx.messages.map(m => {
      const mm = m as { content?: unknown; summary?: unknown };
      if (typeof mm.summary === 'string') return mm.summary;
      if (typeof mm.content === 'string') return mm.content;
      return '';
    });
    expect(texts.some(t => t.includes('SUMMARY TEXT'))).toBe(true);
    expect(texts).toContain('kept-boundary');
    expect(texts).toContain('after');
    expect(texts).not.toContain('old-1');
  });
});
