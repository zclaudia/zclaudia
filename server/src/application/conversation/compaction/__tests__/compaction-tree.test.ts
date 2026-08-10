import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { Session, buildSessionContext, type CompactionEntry } from '@earendil-works/pi-agent-core';
import { SqliteSessionStorage } from '../../../../infra/providers/pi-runtime/session-tree/index.js';
import { makeSessionDb } from '../../../../infra/providers/pi-runtime/session-tree/__tests__/fixture.js';
import { appendCompactionToTree } from '../compaction-service.js';

const DETAILS = {
  source: 'auto' as const,
  customInstructions: null,
  readFiles: [] as string[],
  modifiedFiles: [] as string[],
};

describe('appendCompactionToTree', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeSessionDb();
  });

  it('writes a compaction entry that context assembly honors as a boundary', async () => {
    const storage = new SqliteSessionStorage(db, 's1');
    const session = new Session(storage);
    await session.appendMessage({ role: 'user', content: 'old' } as never);
    const keep = { role: 'user', content: 'keep' };
    await session.appendMessage(keep as never);

    // 0.84 keeps the surviving messages on the entry rather than naming the
    // first entry to keep, so the retained tail is what carries them across.
    const id = await appendCompactionToTree(session, {
      summary: 'SUM',
      retainedTail: [keep as never],
      tokensBefore: 99,
      details: DETAILS,
    });
    expect(id).toBeTruthy();

    const ctx = buildSessionContext(await storage.getActivePath());
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

  it('persists rich details on the entry for the timeline reader', async () => {
    const storage = new SqliteSessionStorage(db, 's1');
    const session = new Session(storage);
    const keep = { role: 'user', content: 'keep' };
    await session.appendMessage(keep as never);
    const id = await appendCompactionToTree(session, {
      summary: 'SUM',
      retainedTail: [keep as never],
      tokensBefore: 1234,
      details: {
        source: 'manual',
        customInstructions: 'focus on auth',
        readFiles: ['a.ts'],
        modifiedFiles: ['b.ts'],
      },
    });

    const entry = (await storage.getEntry(id)) as CompactionEntry | undefined;
    expect(entry?.type).toBe('compaction');
    expect(entry?.summary).toBe('SUM');
    expect(entry?.tokensBefore).toBe(1234);
    expect(entry?.retainedTail).toHaveLength(1);
    expect(entry?.details).toMatchObject({
      source: 'manual',
      customInstructions: 'focus on auth',
      readFiles: ['a.ts'],
      modifiedFiles: ['b.ts'],
    });
  });
});
