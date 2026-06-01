import { describe, it, expect, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { __testables } from '../zclaudia-adapter.js';

// Mock pi-ai's getModel so tests don't hit real model registry.
vi.mock('@earendil-works/pi-ai', () => ({
  getModel: vi.fn((provider: string, model: string) => {
    if (provider === 'unknown') throw new Error(`unknown provider: ${provider}`);
    if (model === 'invalid-model') throw new Error(`unknown model: ${model}`);
    return { provider, id: model, contextWindow: 200000, maxTokens: 8000 };
  }),
}));

const { AsyncQueue, buildModel, loadHistory } = __testables;

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

function insertMessage(db: Database.Database, row: { id: string; sessionId: string; role: string; content: string; createdAt: number; offset: number }) {
  db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at, offset) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(row.id, row.sessionId, row.role, row.content, row.createdAt, row.offset);
}

describe('AsyncQueue', () => {
  it('yields pushed values in order then completes on close', async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.push(2);
    q.close();
    const out: number[] = [];
    for await (const v of q) out.push(v);
    expect(out).toEqual([1, 2]);
  });

  it('supports push after iteration starts', async () => {
    const q = new AsyncQueue<string>();
    const collected: string[] = [];
    const consumer = (async () => {
      for await (const v of q) collected.push(v);
    })();
    await Promise.resolve();
    q.push('a');
    await Promise.resolve();
    q.push('b');
    q.close();
    await consumer;
    expect(collected).toEqual(['a', 'b']);
  });

  it('ignores push after close', async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.close();
    q.push(2); // dropped silently
    const out: number[] = [];
    for await (const v of q) out.push(v);
    expect(out).toEqual([1]);
  });

  it('terminates pending consumer when close() is called', async () => {
    const q = new AsyncQueue<number>();
    const collected: number[] = [];
    const consumer = (async () => {
      for await (const v of q) collected.push(v);
    })();
    // Let consumer reach awaiting state on first next()
    await Promise.resolve();
    q.close();
    await consumer;
    expect(collected).toEqual([]);
  });
});

describe('buildModel', () => {
  const originalEnv = { ...process.env };
  afterEach(() => { process.env = { ...originalEnv }; });

  it('uses defaults when env vars unset', () => {
    delete process.env.PI_PROVIDER;
    delete process.env.PI_MODEL;
    const model = buildModel();
    expect(model.provider).toBe('anthropic');
    expect(model.id).toBe('claude-sonnet-4-6');
  });

  it('honors PI_PROVIDER and PI_MODEL env', () => {
    process.env.PI_PROVIDER = 'openai';
    process.env.PI_MODEL = 'gpt-5';
    const model = buildModel();
    expect(model.provider).toBe('openai');
    expect(model.id).toBe('gpt-5');
  });

  it('propagates getModel errors (model not in registry)', () => {
    process.env.PI_MODEL = 'invalid-model';
    expect(() => buildModel()).toThrow(/unknown model: invalid-model/);
  });
});

describe('loadHistory', () => {
  it('returns empty array when sessionId or db missing', () => {
    const db = createTestDb();
    expect(loadHistory(undefined, 's1')).toEqual([]);
    expect(loadHistory(db, undefined)).toEqual([]);
    expect(loadHistory(db, 's1')).toEqual([]);
  });

  it('returns messages in chronological order', () => {
    const db = createTestDb();
    insertMessage(db, { id: 'm1', sessionId: 's1', role: 'user', content: 'hi',     createdAt: 100, offset: 1 });
    insertMessage(db, { id: 'm2', sessionId: 's1', role: 'assistant', content: 'hello',  createdAt: 200, offset: 2 });
    insertMessage(db, { id: 'm3', sessionId: 's1', role: 'user', content: 'how are you', createdAt: 300, offset: 3 });
    // bootstrap inserts current input; trailing user should be popped
    const out = loadHistory(db, 's1');
    expect(out.map(m => m.role)).toEqual(['user', 'assistant']);
    expect((out[0] as { content: string }).content).toBe('hi');
  });

  it('filters out system rows', () => {
    const db = createTestDb();
    insertMessage(db, { id: 'm1', sessionId: 's1', role: 'system',    content: 'sys',  createdAt: 100, offset: 1 });
    insertMessage(db, { id: 'm2', sessionId: 's1', role: 'user',      content: 'hi',   createdAt: 200, offset: 2 });
    insertMessage(db, { id: 'm3', sessionId: 's1', role: 'assistant', content: 'yo',   createdAt: 300, offset: 3 });
    const out = loadHistory(db, 's1');
    expect(out.map(m => m.role)).toEqual(['user', 'assistant']);
  });

  it('does not pop trailing message when it is an assistant', () => {
    const db = createTestDb();
    insertMessage(db, { id: 'm1', sessionId: 's1', role: 'user',      content: 'hi',  createdAt: 100, offset: 1 });
    insertMessage(db, { id: 'm2', sessionId: 's1', role: 'assistant', content: 'hey', createdAt: 200, offset: 2 });
    const out = loadHistory(db, 's1');
    expect(out.map(m => m.role)).toEqual(['user', 'assistant']);
  });

  it('returns assistant message in pi text-content format', () => {
    const db = createTestDb();
    insertMessage(db, { id: 'm1', sessionId: 's1', role: 'assistant', content: 'hello world', createdAt: 100, offset: 1 });
    const out = loadHistory(db, 's1');
    expect(out[0]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'hello world' }],
    });
  });

  it('caps at HISTORY_LIMIT most recent messages', () => {
    const db = createTestDb();
    for (let i = 0; i < 60; i++) {
      insertMessage(db, { id: `m${i}`, sessionId: 's1', role: i % 2 === 0 ? 'user' : 'assistant', content: `msg${i}`, createdAt: 100 + i, offset: i + 1 });
    }
    const out = loadHistory(db, 's1');
    // 60 total messages; HISTORY_LIMIT=50 are loaded (newest 50: m10..m59); last (m59 is assistant since 59%2!=0 → assistant)
    // Trailing assistant -> no pop. So output length = 50.
    expect(out.length).toBe(50);
  });
});
