import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { Session, buildSessionContext} from '@earendil-works/pi-agent-core';
import type { MessageEntry } from '@earendil-works/pi-agent-core';
import { makeSessionDb } from './fixture.js';
import { SqliteSessionStorage } from '../sqlite-session-storage.js';


function msg(role: 'user' | 'assistant', content: string): MessageEntry['message'] {
  return { role, content } as MessageEntry['message'];
}

describe('buildContext over SqliteSessionStorage', () => {
  let db: Database.Database;
  let storage: SqliteSessionStorage;
  beforeEach(() => {
    db = makeSessionDb();
    storage = new SqliteSessionStorage(db, 's1');
  });

  it('rebuilds the root→leaf message path in order', async () => {
    const session = new Session(storage);
    const id1 = await session.appendMessage(msg('user', 'one'));
    const id2 = await session.appendMessage(msg('assistant', 'two'));
    await session.appendMessage(msg('user', 'three'));

    const ctx = buildSessionContext(await session.findEntriesOnBranch({ order: 'oldestFirst' }));
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
    const kept = msg('user', 'kept-boundary');
    const keepId = await session.appendMessage(kept);
    const after = msg('assistant', 'after');
    await session.appendMessage(after);
    // 0.84 has no appendCompaction helper, and the boundary moved: the entry
    // carries the messages that survive rather than naming the first one to
    // keep, so what used to follow from tree position is now listed outright.
    await session.appendEntry(
      {
        type: 'compaction',
        id: 'k1',
        summary: 'SUMMARY TEXT',
        retainedTail: [kept, after],
        tokensBefore: 1234,
      },
      'main'
    );

    const ctx = buildSessionContext(await session.findEntriesOnBranch({ order: 'oldestFirst' }));
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
