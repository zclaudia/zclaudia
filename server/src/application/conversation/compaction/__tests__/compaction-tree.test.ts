import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { Session } from '@earendil-works/pi-agent-core';
import { migration } from '../../../../infra/storage/migrations/021_session_entries.js';
import { SqliteSessionStorage } from '../../../../infra/providers/pi-runtime/session-tree/index.js';
import { appendCompactionToTree } from '../compaction-service.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);`);
  db.exec(`INSERT INTO sessions (id, created_at) VALUES ('s1', 1);`);
  db.exec(migration.sql);
  return db;
}

describe('appendCompactionToTree', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
  });

  it('writes a compaction entry that buildContext honors as a boundary', async () => {
    const session = new Session(new SqliteSessionStorage(db, 's1'));
    await session.appendMessage({ role: 'user', content: 'old' } as never);
    const keep = await session.appendMessage({ role: 'user', content: 'keep' } as never);

    const id = await appendCompactionToTree(session, {
      summary: 'SUM',
      firstKeptEntryId: keep,
      tokensBefore: 99,
      details: { source: 'auto', customInstructions: null, readFiles: [], modifiedFiles: [] },
    });
    expect(id).toBeTruthy();

    const ctx = await session.buildContext();
    // The boundary is materialized as a synthetic `compactionSummary` message
    // (carrying `summary`) followed by the kept tail of real messages.
    const summaryMsgs = ctx.messages.filter(
      m => (m as { role: string }).role === 'compactionSummary'
    );
    expect(summaryMsgs.some(m => (m as { summary?: string }).summary?.includes('SUM'))).toBe(true);
    const contents = ctx.messages.map(m => (m as { content?: string }).content);
    expect(contents).not.toContain('old');
    expect(contents).toContain('keep');
  });

  it('persists rich details under the entry payload for the timeline reader', async () => {
    const session = new Session(new SqliteSessionStorage(db, 's1'));
    const keep = await session.appendMessage({ role: 'user', content: 'keep' } as never);
    const id = await appendCompactionToTree(session, {
      summary: 'SUM',
      firstKeptEntryId: keep,
      tokensBefore: 1234,
      details: {
        source: 'manual',
        customInstructions: 'focus on auth',
        readFiles: ['a.ts'],
        modifiedFiles: ['b.ts'],
      },
    });

    const row = db
      .prepare(`SELECT payload FROM session_entries WHERE id = ? AND type = 'compaction'`)
      .get(id) as { payload: string };
    const payload = JSON.parse(row.payload);
    expect(payload.summary).toBe('SUM');
    expect(payload.firstKeptEntryId).toBe(keep);
    expect(payload.tokensBefore).toBe(1234);
    expect(payload.details).toMatchObject({
      source: 'manual',
      customInstructions: 'focus on auth',
      readFiles: ['a.ts'],
      modifiedFiles: ['b.ts'],
    });
  });
});
