import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Usage } from '@earendil-works/pi-ai';
import { rebuildHistory, HISTORY_SCAN_MAX } from '../history-rebuilder.js';
import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { newId } from '../../../../utils/uuid.js';
import { SessionCompactionRepository } from '../../../../domains/sessions/compaction-repository.js';

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
    CREATE TABLE session_compactions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      first_kept_message_id TEXT NOT NULL,
      tokens_before INTEGER NOT NULL,
      details TEXT,
      source TEXT NOT NULL DEFAULT 'auto',
      custom_instructions TEXT,
      created_at INTEGER NOT NULL
    );
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
    expect(rebuildHistory(undefined, 's1').messages).toEqual([]);
    const db = createTestDb();
    expect(rebuildHistory(db, undefined).messages).toEqual([]);
    expect(rebuildHistory(db, 's1').messages).toEqual([]);
  });

  it('returns chronological pi Messages for plain user + assistant', () => {
    const db = createTestDb();
    insertMsg(db, { id: 'u1', sessionId: 's', role: 'user', content: 'hi', createdAt: 100, offset: 1 });
    insertMsg(db, { id: 'a1', sessionId: 's', role: 'assistant', content: 'hello', createdAt: 200, offset: 2 });
    const { messages: out } = rebuildHistory(db, 's');
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
    const { messages: out } = rebuildHistory(db, 's');
    expect(out).toHaveLength(2);
    expect((out.at(-1) as any).role).toBe('assistant');
  });

  it('skips system rows', () => {
    const db = createTestDb();
    insertMsg(db, { id: 's1', sessionId: 's', role: 'system', content: 'sys', createdAt: 100, offset: 1 });
    insertMsg(db, { id: 'u1', sessionId: 's', role: 'user', content: 'hi', createdAt: 200, offset: 2 });
    insertMsg(db, { id: 'a1', sessionId: 's', role: 'assistant', content: 'hello', createdAt: 300, offset: 3 });
    const { messages: out } = rebuildHistory(db, 's');
    expect(out).toHaveLength(2);
    expect((out[0] as any).role).toBe('user');
  });

  it('injects MCP instructions delta system rows as provider-visible reminders', () => {
    const db = createTestDb();
    insertMsg(db, {
      id: 's1',
      sessionId: 's',
      role: 'system',
      content: 'MCP server instructions updated',
      metadata: {
        type: 'mcp_instructions_delta',
        delta: {
          addedNames: ['github'],
          addedBlocks: ['## github\nUse GitHub safely.'],
          removedNames: [],
          createdAt: 100,
        },
      },
      createdAt: 100,
      offset: 1,
    });
    insertMsg(db, { id: 'u1', sessionId: 's', role: 'user', content: 'hi', createdAt: 200, offset: 2 });
    insertMsg(db, { id: 'a1', sessionId: 's', role: 'assistant', content: 'hello', createdAt: 300, offset: 3 });

    const { messages: out } = rebuildHistory(db, 's');

    expect(out[0]).toEqual(expect.objectContaining({
      role: 'user',
      content: expect.stringContaining('MCP server instructions updated'),
    }));
    expect((out[0] as any).content).toContain('## github\nUse GitHub safely.');
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
    const { messages: out } = rebuildHistory(db, 's');
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
    const { messages: out } = rebuildHistory(db, 's');
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
    const { messages: out } = rebuildHistory(db, 's');
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
    const { messages: out } = rebuildHistory(db, 's');
    const assistant = out[0] as any;
    const types = (assistant.content as any[]).map(b => b.type);
    expect(types).toEqual(['thinking', 'text', 'toolCall']);
  });

  it('falls back to plain text when metadata JSON is malformed', () => {
    const db = createTestDb();
    db.prepare(
      `INSERT INTO messages (id, session_id, role, content, metadata, created_at, offset) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('a1', 's', 'assistant', 'hello', '{broken', 100, 1);
    const { messages: out } = rebuildHistory(db, 's');
    expect(out).toHaveLength(1);
    expect((out[0] as any).role).toBe('assistant');
    expect((out[0] as any).content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('default scan returns more than the old 50 cap (no fixed HISTORY_LIMIT)', () => {
    const db = createTestDb();
    for (let i = 1; i <= 60; i++) {
      insertMsg(db, { id: `m${i}`, sessionId: 's', role: i % 2 ? 'user' : 'assistant', content: `c${i}`, createdAt: i, offset: i });
    }
    // 60 条,末条 offset 60 是 'assistant'(i=60 偶数);无尾部 user 弹出
    const { messages: out } = rebuildHistory(db, 's');
    expect(out.length).toBeGreaterThan(50);
  });

  it('maxMessages caps the number of scanned rows (newest N)', () => {
    const db = createTestDb();
    for (let i = 1; i <= 30; i++) {
      insertMsg(db, { id: `m${i}`, sessionId: 's', role: i % 2 ? 'user' : 'assistant', content: `c${i}`, createdAt: i, offset: i });
    }
    const { messages: out } = rebuildHistory(db, 's', { maxMessages: 10 });
    // 取最新 10 条(offset 21..30),反转为升序;不含早期消息
    expect(out.length).toBeLessThanOrEqual(10);
    expect(JSON.stringify(out)).not.toContain('"c1"');
    expect(JSON.stringify(out)).toContain('c30');
  });

  it('HISTORY_SCAN_MAX is the generous default ceiling', () => {
    expect(HISTORY_SCAN_MAX).toBe(1000);
  });

  it('orders by offset, not created_at, when timestamps collide', () => {
    const db = createTestDb();
    // 同一毫秒 created_at;真实顺序由 offset 决定:user(1) -> assistant(2) -> user(3 popped)
    insertMsg(db, { id: 'u1', sessionId: 's', role: 'user', content: 'q1', createdAt: 100, offset: 1 });
    insertMsg(db, { id: 'a1', sessionId: 's', role: 'assistant', content: 'r1', createdAt: 100, offset: 2 });
    insertMsg(db, { id: 'u2', sessionId: 's', role: 'user', content: 'q2', createdAt: 100, offset: 3 });
    const { messages: out } = rebuildHistory(db, 's');
    expect(out).toHaveLength(2);
    expect((out[0] as any).content).toBe('q1');
    expect((out[1] as any).content).toEqual(expect.arrayContaining([{ type: 'text', text: 'r1' }]));
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

    const { messages } = rebuildHistory(db, 'sess1');
    const assistant = messages.find((m) => m.role === 'assistant');
    expect((assistant as any).usage).toEqual(usage);
  });

  it('falls back to zero usage when metadata.usage is missing', () => {
    const db = createTestDb();
    insertMsg(db, { id: 'm1', sessionId: 'sess1', role: 'user', content: 'hi', createdAt: 999, offset: 1 });
    insertMsg(db, { id: 'm2', sessionId: 'sess1', role: 'assistant', content: 'hello', createdAt: 1000, offset: 2 });

    const { messages } = rebuildHistory(db, 'sess1');
    const assistant = messages.find((m) => m.role === 'assistant');
    expect((assistant as any).usage.totalTokens).toBe(0);
    expect((assistant as any).usage.input).toBe(0);
  });
});

// ── New tests require full schema (compaction tables) ──────────────────────

function seedSessionWithMessages(db: Database.Database, count: number): void {
  db.prepare(`INSERT INTO llm_profiles (id, name, provider_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('lp1', 'p', 'anthropic', 0, 0);
  db.prepare(`INSERT INTO agent_profiles (id, name, llm_profile_id, model, system_prompt, enabled_tools, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('ap1', 'a', 'lp1', 'm', '', '[]', 0, 0);
  db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('p1', 'P', 'code', 0, 0);
  db.prepare(`INSERT INTO sessions (id, project_id, agent_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('s1', 'p1', 'ap1', 0, 0);
  for (let i = 0; i < count; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at, offset) VALUES (?, ?, ?, ?, ?, ?)`).run(`m${i + 1}`, 's1', role, `text${i}`, i * 1000, i + 1);
  }
}

describe('history-rebuilder — RebuiltHistory shape', () => {
  it('returns RebuiltHistory with messages and parallel dbIds', () => {
    const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); applyMigrations(db);
    seedSessionWithMessages(db, 2);
    const result = rebuildHistory(db, 's1');
    expect(result.messages.length).toBe(result.dbIds.length);
    expect(result.dbIds).toContain('m1');
  });
});

describe('history-rebuilder — compaction injection', () => {
  it('no compaction → behaves as before (no synthesized prefix)', () => {
    const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); applyMigrations(db);
    seedSessionWithMessages(db, 4);
    const { messages, dbIds } = rebuildHistory(db, 's1');
    const firstContent = typeof messages[0]?.content === 'string' ? messages[0].content : '';
    expect(firstContent).not.toContain('compacted into the following summary');
    expect(dbIds[0]).not.toBeNull();
  });

  it('compaction exists → first message is synthesized summary user message', () => {
    const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); applyMigrations(db);
    seedSessionWithMessages(db, 4);
    new SessionCompactionRepository(db).create({
      id: newId(), sessionId: 's1', summary: 'SUMMARY-TEXT',
      firstKeptMessageId: 'm3', tokensBefore: 100,
      source: 'auto', createdAt: 5000,
    });
    const { messages, dbIds } = rebuildHistory(db, 's1');
    expect(messages[0].role).toBe('user');
    const content = typeof messages[0].content === 'string' ? messages[0].content : '';
    expect(content).toContain('SUMMARY-TEXT');
    expect(content).toContain('compacted into the following summary');
    expect(dbIds[0]).toBeNull();
  });

  it('compaction exists → messages before boundary are filtered out', () => {
    const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); applyMigrations(db);
    seedSessionWithMessages(db, 4);
    new SessionCompactionRepository(db).create({
      id: newId(), sessionId: 's1', summary: 'sum',
      firstKeptMessageId: 'm3', tokensBefore: 100,
      source: 'auto', createdAt: 5000,
    });
    const { dbIds } = rebuildHistory(db, 's1');
    expect(dbIds).not.toContain('m1');
    expect(dbIds).not.toContain('m2');
    expect(dbIds).toContain('m3');
  });

  it('multiple compactions → only the latest is applied', () => {
    const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); applyMigrations(db);
    seedSessionWithMessages(db, 6);
    const repo = new SessionCompactionRepository(db);
    repo.create({ id: newId(), sessionId: 's1', summary: 'OLD', firstKeptMessageId: 'm2', tokensBefore: 50, source: 'auto', createdAt: 1000 });
    repo.create({ id: newId(), sessionId: 's1', summary: 'NEW', firstKeptMessageId: 'm5', tokensBefore: 200, source: 'auto', createdAt: 2000 });
    const { messages, dbIds } = rebuildHistory(db, 's1');
    const firstContent = typeof messages[0].content === 'string' ? messages[0].content : '';
    expect(firstContent).toContain('NEW');
    expect(dbIds).not.toContain('m4');
    expect(dbIds).toContain('m5');
  });

  it('synthesized summary uses pi-style PREFIX/SUFFIX literally', () => {
    const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); applyMigrations(db);
    seedSessionWithMessages(db, 4);
    new SessionCompactionRepository(db).create({
      id: newId(), sessionId: 's1', summary: 'MID',
      firstKeptMessageId: 'm3', tokensBefore: 1, source: 'auto', createdAt: 5000,
    });
    const { messages } = rebuildHistory(db, 's1');
    const content = typeof messages[0].content === 'string' ? messages[0].content : '';
    expect(content.startsWith('The conversation history before this point was compacted into the following summary:\n\n<summary>\n')).toBe(true);
    expect(content.endsWith('\n</summary>')).toBe(true);
    expect(content).toContain('MID');
  });

  it('first_kept_message_id missing → fallback to no-compaction + warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = new Database(':memory:'); applyMigrations(db);
    seedSessionWithMessages(db, 4);
    db.pragma('foreign_keys = OFF'); // Must disable FK to insert orphan boundary row
    db.prepare(`INSERT INTO session_compactions (id, session_id, summary, first_kept_message_id, tokens_before, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(newId(), 's1', 'orphan', 'nonexistent-id', 1, 'auto', 1000);
    db.pragma('foreign_keys = ON');
    const { messages } = rebuildHistory(db, 's1');
    // Without valid boundary, treat as no compaction
    const firstContent = typeof messages[0]?.content === 'string' ? messages[0].content : '';
    expect(firstContent).not.toContain('compacted');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ── Image rehydration tests ────────────────────────────────────────────────

describe('history-rebuilder — image rehydration', () => {
  it('rebuilds image attachments into user message content', () => {
    const db = createTestDb();
    const sessionId = 's-img';
    insertMsg(db, {
      id: 'u1', sessionId, role: 'user', content: 'see image',
      metadata: {
        attachments: [{ fileId: 'f1', name: 'a.png', mimeType: 'image/png', type: 'image' }],
      },
      createdAt: 100, offset: 1,
    });
    insertMsg(db, { id: 'a1', sessionId, role: 'assistant', content: 'noted', createdAt: 200, offset: 2 });

    const resolveImages = () => ({
      images: [{ name: 'a.png', mimeType: 'image/png', data: 'QQ==' }],
      notices: [],
    });
    const { messages } = rebuildHistory(db, sessionId, { resolveImages });
    const user = messages.find((m) => m.role === 'user');
    expect(user!.content).toEqual([
      { type: 'text', text: 'see image' },
      { type: 'image', data: 'QQ==', mimeType: 'image/png' },
    ]);
  });

  it('falls back to a text placeholder when the file is gone', () => {
    const db = createTestDb();
    const sessionId = 's-img-gone';
    insertMsg(db, {
      id: 'u1', sessionId, role: 'user', content: 'see image',
      metadata: {
        attachments: [{ fileId: 'f1', name: 'a.png', mimeType: 'image/png', type: 'image' }],
      },
      createdAt: 100, offset: 1,
    });
    insertMsg(db, { id: 'a1', sessionId, role: 'assistant', content: 'noted', createdAt: 200, offset: 2 });

    const resolveImages = () => ({
      images: [],
      notices: ['[Image attached: a.png — file unavailable]'],
    });
    const { messages } = rebuildHistory(db, sessionId, { resolveImages });
    const user = messages.find((m) => m.role === 'user');
    expect(user!.content).toBe('see image\n\n[Image attached: a.png — file unavailable]');
  });

  it('user rows without attachment metadata are untouched (string content)', () => {
    const db = createTestDb();
    const sessionId = 's-plain';
    insertMsg(db, { id: 'u1', sessionId, role: 'user', content: 'plain message', createdAt: 100, offset: 1 });
    insertMsg(db, { id: 'a1', sessionId, role: 'assistant', content: 'ok', createdAt: 200, offset: 2 });

    const resolveImages = () => ({ images: [], notices: [] });
    const { messages } = rebuildHistory(db, sessionId, { resolveImages });
    const user = messages.find((m) => m.role === 'user');
    expect(user!.content).toBe('plain message');
  });

  it('never throws when image resolution explodes', () => {
    const db = createTestDb();
    const sessionId = 's-explode';
    insertMsg(db, {
      id: 'u1', sessionId, role: 'user', content: 'boom',
      metadata: {
        attachments: [{ fileId: 'f1', name: 'x.png', mimeType: 'image/png', type: 'image' }],
      },
      createdAt: 100, offset: 1,
    });
    insertMsg(db, { id: 'a1', sessionId, role: 'assistant', content: 'ok', createdAt: 200, offset: 2 });

    const resolveImages = (): never => { throw new Error('storage offline'); };
    expect(() => rebuildHistory(db, sessionId, { resolveImages })).not.toThrow();
    const { messages } = rebuildHistory(db, sessionId, { resolveImages });
    const user = messages.find((m) => m.role === 'user');
    expect(user!.content).toBe('boom');
  });

  it('existing callers without options compile and behave unchanged', () => {
    const db = createTestDb();
    insertMsg(db, { id: 'u1', sessionId: 's-compat', role: 'user', content: 'hi', createdAt: 100, offset: 1 });
    insertMsg(db, { id: 'a1', sessionId: 's-compat', role: 'assistant', content: 'hello', createdAt: 200, offset: 2 });
    // No options arg — should not throw and should return string content
    const { messages } = rebuildHistory(db, 's-compat');
    const user = messages.find((m) => m.role === 'user');
    expect(user!.content).toBe('hi');
  });
});
