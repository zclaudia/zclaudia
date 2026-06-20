import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { Session } from '@earendil-works/pi-agent-core';
import { migration } from '../../../../storage/migrations/021_session_entries.js';
import { SqliteSessionStorage } from '../sqlite-session-storage.js';
import { projectEntriesToMessageRows } from '../message-projection.js';
import {
  buildUserMessage, buildAssistantTurnMessages, appendMessagesToTree,
} from '../write-path.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);`);
  db.exec(`INSERT INTO sessions (id, created_at) VALUES ('s1', 1000);`);
  db.exec(migration.sql);
  return db;
}

describe('write-path builders', () => {
  it('buildUserMessage: plain text', () => {
    expect(buildUserMessage('hi', [])).toEqual({ role: 'user', content: 'hi' });
  });

  it('buildUserMessage: image attachment becomes a ref-carrying image block', () => {
    const att = { type: 'image', name: 'a.png', fileId: 'f1', mimeType: 'image/png' } as never;
    const msg = buildUserMessage('look', [att]) as { role: string; content: any[] };
    expect(msg.role).toBe('user');
    expect(msg.content[0]).toEqual({ type: 'text', text: 'look' });
    expect(msg.content[1].type).toBe('image');
    expect(msg.content[1].attachmentRef).toEqual(att); // ref carried, no bytes
    expect(msg.content[1].data).toBeUndefined();
  });

  it('buildAssistantTurnMessages: assistant block + one toolResult per call', () => {
    const msgs = buildAssistantTurnMessages({
      fullContent: 'done',
      thinkingBlocks: [{ text: 'hmm', signature: 'sig' }],
      collectedToolCalls: [{ toolUseId: 'tc1', name: 'edit', input: { p: 1 }, output: 'ok', isError: false }],
    }) as any[];
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('assistant');
    const types = msgs[0].content.map((b: any) => b.type);
    expect(types).toEqual(['thinking', 'text', 'toolCall']);
    expect(msgs[0].content[2]).toMatchObject({ type: 'toolCall', id: 'tc1', name: 'edit', arguments: { p: 1 } });
    expect(msgs[1]).toMatchObject({ role: 'toolResult', toolCallId: 'tc1', toolName: 'edit', isError: false });
    expect(msgs[1].content).toEqual([{ type: 'text', text: 'ok' }]);
  });

  it('buildAssistantTurnMessages: carries usage onto the assistant message', () => {
    const msgs = buildAssistantTurnMessages({
      fullContent: 'done',
      collectedToolCalls: [],
      usage: { input: 12, output: 34, cacheRead: 56 },
    }) as any[];
    expect(msgs[0].role).toBe('assistant');
    expect(msgs[0].usage).toEqual({ input: 12, output: 34, cacheRead: 56 });
  });

  it('buildAssistantTurnMessages: omits usage when not provided', () => {
    const msgs = buildAssistantTurnMessages({ fullContent: 'a', collectedToolCalls: [] }) as any[];
    expect(msgs[0].usage).toBeUndefined();
  });

  it('usage survives the tree round-trip and is readable for the compaction threshold', async () => {
    const { Session: _S } = await import('@earendil-works/pi-agent-core');
    const { lastAssistantPromptTokens } = await import('../../../../../application/conversation/compaction/context-estimate.js');
    const db = makeDb();
    appendMessagesToTree(db, 's1', [buildUserMessage('q', [])]);
    appendMessagesToTree(db, 's1', buildAssistantTurnMessages({
      fullContent: 'a', collectedToolCalls: [], usage: { input: 1000, cacheRead: 500, output: 20 },
    }));
    const ctx = await new _S(new SqliteSessionStorage(db, 's1')).buildContext();
    // input + cacheRead + cacheWrite (output excluded) = 1500
    expect(lastAssistantPromptTokens(ctx.messages as any)).toBe(1500);
  });

  it('appendMessagesToTree writes entries readable via buildContext, chained + leaf advanced', async () => {
    const db = makeDb();
    appendMessagesToTree(db, 's1', [buildUserMessage('q', [])]);
    appendMessagesToTree(db, 's1', buildAssistantTurnMessages({ fullContent: 'a', collectedToolCalls: [] }));
    const ctx = await new Session(new SqliteSessionStorage(db, 's1')).buildContext();
    expect(ctx.messages.map((m: any) => m.role)).toEqual(['user', 'assistant']);
    expect((ctx.messages[0] as any).content).toBe('q');
  });

  it('appendMessagesToTree is atomic: a mid-batch failure rolls back the whole turn + leaf', () => {
    const db = makeDb();
    appendMessagesToTree(db, 's1', [buildUserMessage('q', [])]);
    const leafBefore = (db.prepare(`SELECT leaf_id AS l FROM session_leaf WHERE session_id='s1'`).get() as { l: string }).l;
    const countBefore = (db.prepare(`SELECT count(*) AS c FROM session_entries WHERE session_id='s1'`).get() as { c: number }).c;

    // Second message has circular content → JSON.stringify throws after the first is inserted.
    const circular: any = { role: 'assistant', content: 'x' };
    circular.content = circular;
    expect(() => appendMessagesToTree(db, 's1', [
      { role: 'assistant', content: 'ok' } as any,
      circular,
    ])).toThrow();

    const countAfter = (db.prepare(`SELECT count(*) AS c FROM session_entries WHERE session_id='s1'`).get() as { c: number }).c;
    const leafAfter = (db.prepare(`SELECT leaf_id AS l FROM session_leaf WHERE session_id='s1'`).get() as { l: string }).l;
    expect(countAfter).toBe(countBefore); // the 'ok' entry was rolled back
    expect(leafAfter).toBe(leafBefore);   // leaf not advanced
  });

  it('projection parity: tree entries collapse to the coarse messages rows', async () => {
    const db = makeDb();
    appendMessagesToTree(db, 's1', [buildUserMessage('q', [])]);
    appendMessagesToTree(db, 's1', buildAssistantTurnMessages({
      fullContent: 'a', collectedToolCalls: [{ toolUseId: 't1', name: 'read', input: {}, output: 'file', isError: false }],
    }));
    const branch = await new SqliteSessionStorage(db, 's1').getEntries();
    const rows = projectEntriesToMessageRows(branch);
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant']);
    expect(rows[0].content).toBe('q');
    expect(rows[1].content).toBe('a');
    expect(rows[1].metadata?.toolCalls).toEqual([
      { toolUseId: 't1', name: 'read', input: {}, output: 'file', isError: false },
    ]);
  });
});
