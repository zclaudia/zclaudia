import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import { __testables, ZClaudiaAdapter } from '../zclaudia-adapter.js';
import type { RunOptions, ClaudeMessage } from '../types.js';

// Mock pi-ai's getModel so tests don't hit real model registry.
vi.mock('@earendil-works/pi-ai', () => ({
  getModel: vi.fn((provider: string, model: string) => {
    if (provider === 'unknown') throw new Error(`unknown provider: ${provider}`);
    if (model === 'invalid-model') throw new Error(`unknown model: ${model}`);
    return { provider, id: model, contextWindow: 200000, maxTokens: 8000 };
  }),
}));

// Hoisted collections used inside vi.mock factory.
const { mockAgentInstances, scriptQueue } = vi.hoisted(() => ({
  mockAgentInstances: [] as Array<{
    initialState: { systemPrompt: string; model: unknown; messages: unknown[] };
    promptCalls: Array<{ input: string }>;
  }>,
  scriptQueue: [] as Array<{ events: AgentEvent[]; rejectWith?: Error }>,
}));

vi.mock('@earendil-works/pi-agent-core', () => {
  class MockAgent {
    initialState: { systemPrompt: string; model: unknown; messages: unknown[] };
    private listener?: (event: AgentEvent) => void;
    constructor(opts: { initialState: { systemPrompt: string; model: unknown; messages: unknown[] } }) {
      this.initialState = opts.initialState;
      mockAgentInstances.push({
        initialState: opts.initialState,
        promptCalls: [],
      });
    }
    subscribe(listener: (event: AgentEvent) => void): () => void {
      this.listener = listener;
      return () => { this.listener = undefined; };
    }
    async prompt(input: string): Promise<void> {
      const slot = mockAgentInstances[mockAgentInstances.length - 1];
      slot.promptCalls.push({ input });
      const script = scriptQueue.shift() ?? { events: [] };
      // Yield once so the adapter's for-await loop has started consuming.
      await Promise.resolve();
      for (const event of script.events) {
        this.listener?.(event);
        // Give the queue a microtask between events so consumers can interleave.
        await Promise.resolve();
      }
      if (script.rejectWith) throw script.rejectWith;
    }
    abort(): void {
      // No-op for tests: pi documents abort() as safe to call on an idle agent.
    }
  }
  return { Agent: MockAgent };
});

// Helper to enqueue the script that the next `new Agent()` will play back.
function scriptNextAgent(events: AgentEvent[], options?: { rejectWith?: Error }) {
  scriptQueue.push({ events, rejectWith: options?.rejectWith });
}

const { AsyncQueue, buildModel, loadHistory, translateEvent } = __testables;

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
    delete process.env.OPENAI_BASE_URL;
    const { model } = buildModel();
    expect(model.provider).toBe('anthropic');
    expect(model.id).toBe('claude-sonnet-4-6');
  });

  it('honors PI_PROVIDER and PI_MODEL env', () => {
    delete process.env.OPENAI_BASE_URL;
    process.env.PI_PROVIDER = 'openai';
    process.env.PI_MODEL = 'gpt-5';
    const { model } = buildModel();
    expect(model.provider).toBe('openai');
    expect(model.id).toBe('gpt-5');
  });

  it('propagates getModel errors (model not in registry)', () => {
    delete process.env.OPENAI_BASE_URL;
    process.env.PI_MODEL = 'invalid-model';
    expect(() => buildModel()).toThrow(/unknown model: invalid-model/);
  });

  it('builds custom OpenAI-compatible model when OPENAI_BASE_URL is set', () => {
    process.env.OPENAI_BASE_URL = 'https://api.deepseek.com/v1';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_MODEL = 'deepseek-chat';
    const { model, getApiKey } = buildModel();
    expect(model.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(model.id).toBe('deepseek-chat');
    expect(model.api).toBe('openai-completions');
    expect(typeof getApiKey).toBe('function');
  });

  it('OPENAI_BASE_URL custom model: getApiKey returns OPENAI_API_KEY', async () => {
    process.env.OPENAI_BASE_URL = 'https://example.com/v1';
    process.env.OPENAI_API_KEY = 'sk-real-key';
    const { getApiKey } = buildModel();
    expect(await getApiKey!('whatever')).toBe('sk-real-key');
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

describe('translateEvent', () => {
  const ctx = { sessionId: 'test-session', model: 'claude-sonnet-4-6', cwd: '/tmp' };

  it('does not translate agent_start (run() emits init manually)', () => {
    const out = translateEvent({ type: 'agent_start' }, ctx);
    expect(out).toBeUndefined();
  });

  it('translates message_update text_delta to assistant chunk', () => {
    const out = translateEvent({
      type: 'message_update',
      message: { role: 'assistant', content: [] },
      assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
    }, ctx);
    expect(out).toEqual({ type: 'assistant', content: 'Hello' });
  });

  it('ignores non-text_delta message_update events', () => {
    const out = translateEvent({
      type: 'message_update',
      message: { role: 'assistant', content: [] },
      assistantMessageEvent: { type: 'thinking_delta', delta: 'pondering' },
    }, ctx);
    expect(out).toBeUndefined();
  });

  it('translates agent_end with usage to result', () => {
    const out = translateEvent({
      type: 'agent_end',
      messages: [],
    }, ctx, { inputTokens: 42, outputTokens: 17 });
    expect(out).toMatchObject({
      type: 'result',
      isComplete: true,
      usage: { inputTokens: 42, outputTokens: 17 },
    });
  });

  it('translates agent_end without usage to result with zeros', () => {
    const out = translateEvent({ type: 'agent_end', messages: [] }, ctx);
    expect(out).toMatchObject({
      type: 'result',
      isComplete: true,
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });

  it('ignores message_start, message_end, turn_start, turn_end', () => {
    expect(translateEvent({ type: 'message_start', message: { role: 'user', content: 'x', timestamp: 0 } }, ctx)).toBeUndefined();
    expect(translateEvent({ type: 'message_end', message: { role: 'user', content: 'x', timestamp: 0 } }, ctx)).toBeUndefined();
    expect(translateEvent({ type: 'turn_start' }, ctx)).toBeUndefined();
    expect(translateEvent({ type: 'turn_end', message: { role: 'assistant', content: [] }, toolResults: [] }, ctx)).toBeUndefined();
  });

  it('ignores unknown event types without throwing', () => {
    const out = translateEvent({ type: '_future_unknown_' as never }, ctx);
    expect(out).toBeUndefined();
  });

  it('ignores tool_execution_* events in MVP', () => {
    expect(translateEvent({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'read', args: {} }, ctx)).toBeUndefined();
    expect(translateEvent({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'read', result: {}, isError: false }, ctx)).toBeUndefined();
  });
});

async function collect(adapter: ZClaudiaAdapter, input: string, options: Partial<RunOptions>): Promise<ClaudeMessage[]> {
  const opts: RunOptions = {
    cwd: '/tmp',
    sessionId: 'sess-test',
    ...options,
  } as RunOptions;
  const out: ClaudeMessage[] = [];
  for await (const m of adapter.run(input, opts, async () => ({ behavior: 'allow' }))) {
    out.push(m);
  }
  return out;
}

describe('ZClaudiaAdapter.run', () => {
  beforeEach(() => {
    mockAgentInstances.length = 0;
    scriptQueue.length = 0;
  });

  it('happy path: emits init, streamed assistant chunks, and result', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'text_delta', delta: 'Hel' } },
      { type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'text_delta', delta: 'lo' } },
      { type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'text_delta', delta: '!' } },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new ZClaudiaAdapter();
    const out = await collect(adapter, 'hello', {});

    expect(out.map(m => m.type)).toEqual(['init', 'assistant', 'assistant', 'assistant', 'result']);
    expect(out.filter(m => m.type === 'assistant').map(m => m.content)).toEqual(['Hel', 'lo', '!']);
    expect(out[out.length - 1].isComplete).toBe(true);
  });

  it('extracts usage from agent_end.messages last assistant', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'text_delta', delta: 'reply' } },
      { type: 'agent_end', messages: [
        { role: 'user', content: 'hi', timestamp: 0 },
        { role: 'assistant', content: [{ type: 'text', text: 'reply' }], stopReason: 'stop', usage: { input: 100, output: 50 }, timestamp: 0 } as any,
      ] },
    ]);

    const adapter = new ZClaudiaAdapter();
    const out = await collect(adapter, 'hi', {});

    const last = out[out.length - 1];
    expect(last.type).toBe('result');
    expect(last.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  it('loads history from DB and passes it to Agent initialState', async () => {
    const db = createTestDb();
    insertMessage(db, { id: 'h1', sessionId: 'sess-test', role: 'user',      content: 'prev question', createdAt: 100, offset: 1 });
    insertMessage(db, { id: 'h2', sessionId: 'sess-test', role: 'assistant', content: 'prev answer',   createdAt: 200, offset: 2 });

    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new ZClaudiaAdapter();
    await collect(adapter, 'follow up', { db, claudiaSessionId: 'sess-test' });

    expect(mockAgentInstances.length).toBe(1);
    const initialMessages = mockAgentInstances[0].initialState.messages;
    expect(initialMessages.map((m: any) => m.role)).toEqual(['user', 'assistant']);
    expect((initialMessages[0] as any).content).toBe('prev question');
    expect(mockAgentInstances[0].promptCalls[0].input).toBe('follow up');
  });

  it('config error (getModel throws): yields init then error(isComplete) and stops', async () => {
    process.env.PI_MODEL = 'invalid-model';
    const adapter = new ZClaudiaAdapter();
    const out = await collect(adapter, 'hi', {});
    delete process.env.PI_MODEL;

    expect(out.map(m => m.type)).toEqual(['init', 'error']);
    expect(out[1].isComplete).toBe(true);
    expect(out[1].error).toMatch(/unknown model/);
  });

  it('LLM error: yields error(isComplete) at end of stream', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
    ], { rejectWith: new Error('Anthropic 429') });

    const adapter = new ZClaudiaAdapter();
    const out = await collect(adapter, 'hi', {});

    expect(out[0].type).toBe('init');
    const last = out[out.length - 1];
    expect(last.type).toBe('error');
    expect(last.error).toMatch(/Anthropic 429/);
    expect(last.isComplete).toBe(true);
  });

  it('history load failure: yields non-terminal error then continues with empty history', async () => {
    const brokenDb = {
      prepare: () => { throw new Error('disk error'); },
    } as unknown as Database.Database;

    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'text_delta', delta: 'ok' } },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new ZClaudiaAdapter();
    const out = await collect(adapter, 'hi', { db: brokenDb, claudiaSessionId: 'sess-test' });

    const errors = out.filter(m => m.type === 'error');
    expect(errors.length).toBe(1);
    expect(errors[0].isComplete).toBeFalsy();
    expect(out[out.length - 1].type).toBe('result');
    expect(mockAgentInstances[0].initialState.messages).toEqual([]);
  });

  it('unknown pi event types do not break stream', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: '_future_' as any },
      { type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'text_delta', delta: 'a' } },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new ZClaudiaAdapter();
    const out = await collect(adapter, 'hi', {});

    expect(out.map(m => m.type)).toEqual(['init', 'assistant', 'result']);
  });
});
