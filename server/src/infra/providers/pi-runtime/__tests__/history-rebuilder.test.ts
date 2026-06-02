import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import type { Usage } from '@earendil-works/pi-ai';
import { rebuildHistory, HISTORY_LIMIT } from '../history-rebuilder.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT CHECK(role IN ('user', 'assistant', 'system')) NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      offset INTEGER
    );
    CREATE INDEX idx_messages_session_offset ON messages(session_id, offset);
  `);
  return db;
}

function insertMsg(db: Database.Database, args: {
  id: string; sessionId: string; role: string; content: string;
  metadata?: object; createdAt: number; offset: number;
}) {
  db.prepare(
    `INSERT INTO messages (id, session_id, role, content, metadata, created_at, offset) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(args.id, args.sessionId, args.role, args.content, args.metadata ? JSON.stringify(args.metadata) : null, args.createdAt, args.offset);
}

describe('rebuildHistory', () => {
  it('returns empty for missing db or sessionId', () => {
    expect(rebuildHistory(undefined, 's1')).toEqual([]);
    const db = createTestDb();
    expect(rebuildHistory(db, undefined)).toEqual([]);
    expect(rebuildHistory(db, 's1')).toEqual([]);
  });

  it('returns chronological pi Messages for plain user + assistant', () => {
    const db = createTestDb();
    insertMsg(db, { id: 'u1', sessionId: 's', role: 'user', content: 'hi', createdAt: 100, offset: 1 });
    insertMsg(db, { id: 'a1', sessionId: 's', role: 'assistant', content: 'hello', createdAt: 200, offset: 2 });
    const out = rebuildHistory(db, 's');
    expect(out).toHaveLength(2);
    expect((out[0] as any).role).toBe('user');
    expect((out[1] as any).role).toBe('assistant');
    expect((out[1] as any).content).toEqual(expect.arrayContaining([{ type: 'text', text: 'hello' }]));
  });

  it('pops trailing user message (current turn input, already in pi prompt arg)', () => {
    const db = createTestDb();
    insertMsg(db, { id: 'u1', sessionId: 's', role: 'user', content: 'first', createdAt: 100, offset: 1 });
    insertMsg(db, { id: 'a1', sessionId: 's', role: 'assistant', content: 'reply', createdAt: 200, offset: 2 });
    insertMsg(db, { id: 'u2', sessionId: 's', role: 'user', content: 'current', createdAt: 300, offset: 3 });
    const out = rebuildHistory(db, 's');
    expect(out).toHaveLength(2);
    expect((out.at(-1) as any).role).toBe('assistant');
  });

  it('skips system rows', () => {
    const db = createTestDb();
    insertMsg(db, { id: 's1', sessionId: 's', role: 'system', content: 'sys', createdAt: 100, offset: 1 });
    insertMsg(db, { id: 'u1', sessionId: 's', role: 'user', content: 'hi', createdAt: 200, offset: 2 });
    insertMsg(db, { id: 'a1', sessionId: 's', role: 'assistant', content: 'hello', createdAt: 300, offset: 3 });
    const out = rebuildHistory(db, 's');
    expect(out).toHaveLength(2);
    expect((out[0] as any).role).toBe('user');
  });

  it('reconstructs assistant content with toolCalls + emits matching toolResult messages', () => {
    const db = createTestDb();
    insertMsg(db, { id: 'u1', sessionId: 's', role: 'user', content: 'read file', createdAt: 100, offset: 1 });
    insertMsg(db, {
      id: 'a1', sessionId: 's', role: 'assistant', content: 'I read it',
      metadata: {
        toolCalls: [
          { toolUseId: 't1', name: 'read', input: { path: '/x' }, output: 'file body', isError: false },
        ],
      },
      createdAt: 200, offset: 2,
    });
    const out = rebuildHistory(db, 's');
    expect(out).toHaveLength(3);
    const assistant = out[1] as any;
    expect(assistant.role).toBe('assistant');
    const tcBlock = (assistant.content as any[]).find(b => b.type === 'toolCall');
    expect(tcBlock).toEqual({ type: 'toolCall', id: 't1', name: 'read', arguments: { path: '/x' } });
    const toolResult = out[2] as any;
    expect(toolResult.role).toBe('toolResult');
    expect(toolResult.toolCallId).toBe('t1');
    expect(toolResult.isError).toBe(false);
  });

  it('marks toolResult.isError=true when tool failed', () => {
    const db = createTestDb();
    insertMsg(db, {
      id: 'a1', sessionId: 's', role: 'assistant', content: '',
      metadata: { toolCalls: [{ toolUseId: 't1', name: 'bash', input: {}, output: 'oops', isError: true }] },
      createdAt: 100, offset: 1,
    });
    const out = rebuildHistory(db, 's');
    const toolResult = out.at(-1) as any;
    expect(toolResult.role).toBe('toolResult');
    expect(toolResult.isError).toBe(true);
  });

  it('puts thinking blocks before text in assistant content', () => {
    const db = createTestDb();
    insertMsg(db, {
      id: 'a1', sessionId: 's', role: 'assistant', content: 'final answer',
      metadata: { thinkingBlocks: [{ text: 'let me think', signature: 'sig123' }] },
      createdAt: 100, offset: 1,
    });
    const out = rebuildHistory(db, 's');
    const assistant = out[0] as any;
    expect(assistant.content[0]).toEqual({ type: 'thinking', thinking: 'let me think', thinkingSignature: 'sig123' });
    expect(assistant.content[1]).toEqual({ type: 'text', text: 'final answer' });
  });

  it('thinking + toolCalls + text together, in order: thinking, text, toolCall', () => {
    const db = createTestDb();
    insertMsg(db, {
      id: 'a1', sessionId: 's', role: 'assistant', content: 'using read',
      metadata: {
        thinkingBlocks: [{ text: 'thinking' }],
        toolCalls: [{ toolUseId: 't1', name: 'read', input: { path: '/x' }, output: 'body' }],
      },
      createdAt: 100, offset: 1,
    });
    const out = rebuildHistory(db, 's');
    const assistant = out[0] as any;
    const types = (assistant.content as any[]).map(b => b.type);
    expect(types).toEqual(['thinking', 'text', 'toolCall']);
  });

  it('falls back to plain text when metadata JSON is malformed', () => {
    const db = createTestDb();
    db.prepare(
      `INSERT INTO messages (id, session_id, role, content, metadata, created_at, offset) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('a1', 's', 'assistant', 'hello', '{broken', 100, 1);
    const out = rebuildHistory(db, 's');
    expect(out).toHaveLength(1);
    expect((out[0] as any).role).toBe('assistant');
    expect((out[0] as any).content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('caps at HISTORY_LIMIT messages (newest N)', () => {
    const db = createTestDb();
    for (let i = 0; i < 60; i++) {
      insertMsg(db, {
        id: `m${i}`, sessionId: 's',
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `msg${i}`, createdAt: 100 + i, offset: i + 1,
      });
    }
    const out = rebuildHistory(db, 's');
    expect(out.length).toBe(50);
    expect(HISTORY_LIMIT).toBe(50);
  });
});

describe('history-rebuilder — usage handling', () => {
  it('reconstructs real usage from assistant metadata when present', () => {
    const db = createTestDb();
    const usage: Usage = {
      input: 100, output: 200, cacheRead: 5, cacheWrite: 0, totalTokens: 305,
      cost: { input: 0.001, output: 0.005, cacheRead: 0, cacheWrite: 0, total: 0.006 },
    };
    insertMsg(db, { id: 'm1', sessionId: 'sess1', role: 'user', content: 'hi', createdAt: 999, offset: 1 });
    insertMsg(db, { id: 'm2', sessionId: 'sess1', role: 'assistant', content: 'hello', metadata: { usage }, createdAt: 1000, offset: 2 });

    const messages = rebuildHistory(db, 'sess1');
    const assistant = messages.find((m) => m.role === 'assistant');
    expect((assistant as any).usage).toEqual(usage);
  });

  it('falls back to zero usage when metadata.usage is missing', () => {
    const db = createTestDb();
    insertMsg(db, { id: 'm1', sessionId: 'sess1', role: 'user', content: 'hi', createdAt: 999, offset: 1 });
    insertMsg(db, { id: 'm2', sessionId: 'sess1', role: 'assistant', content: 'hello', createdAt: 1000, offset: 2 });

    const messages = rebuildHistory(db, 'sess1');
    const assistant = messages.find((m) => m.role === 'assistant');
    expect((assistant as any).usage.totalTokens).toBe(0);
    expect((assistant as any).usage.input).toBe(0);
  });
});
