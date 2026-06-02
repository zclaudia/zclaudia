import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core';
import { __testables, ZClaudiaAdapter } from '../zclaudia-adapter.js';
import type { RunOptions, ClaudeMessage, SteerHandle } from '../types.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { AgentProfileConfig, ThinkingLevel } from '@zclaudia/shared/core/agent-profile';
import type { ToolName } from '@zclaudia/shared/core/tools';

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
    initialState: { systemPrompt: string; model: unknown; messages: unknown[]; tools?: unknown[] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructorOpts: any;
    promptCalls: Array<{ input: string }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    steerCalls: any[];
  }>,
  scriptQueue: [] as Array<{ events: AgentEvent[]; rejectWith?: Error }>,
}));

vi.mock('@earendil-works/pi-agent-core', () => {
  class MockAgent {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialState: any;
    private listener?: (event: AgentEvent) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private slot: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(opts: { initialState: any; [k: string]: any }) {
      this.initialState = opts.initialState;
      this.slot = {
        initialState: opts.initialState,
        constructorOpts: opts,
        promptCalls: [],
        steerCalls: [],
      };
      mockAgentInstances.push(this.slot);
    }
    subscribe(listener: (event: AgentEvent) => void): () => void {
      this.listener = listener;
      return () => { this.listener = undefined; };
    }
    async prompt(input: string): Promise<void> {
      this.slot.promptCalls.push({ input });
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    steer(message: any): void {
      this.slot.steerCalls.push(message);
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

const { AsyncQueue, buildModel, translateEvent } = __testables;

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

  it('ignores unknown message_update sub-event types', () => {
    const out = translateEvent({
      type: 'message_update',
      message: { role: 'assistant', content: [] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assistantMessageEvent: { type: '_unknown_sub_event_' as any, delta: 'x' },
    }, ctx);
    expect(out).toBeUndefined();
  });

  it('translates agent_end with usage to result', () => {
    const usage = {
      input: 42, output: 17, cacheRead: 0, cacheWrite: 0, totalTokens: 59,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const out = translateEvent({
      type: 'agent_end',
      messages: [],
    }, ctx, usage);
    expect(out).toMatchObject({
      type: 'result',
      isComplete: true,
      usage,
    });
  });

  it('translates agent_end without usage to result with zeros', () => {
    const out = translateEvent({ type: 'agent_end', messages: [] }, ctx);
    expect(out).toMatchObject({
      type: 'result',
      isComplete: true,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
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

  it('sums usage across all assistant messages in agent_end', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'text_delta', delta: 'reply' } },
      { type: 'agent_end', messages: [
        { role: 'user', content: 'hi', timestamp: 0 },
        { role: 'assistant', content: [{ type: 'text', text: 'first' }], stopReason: 'toolUse', usage: { input: 100, output: 50, cacheRead: 5, cacheWrite: 0, totalTokens: 155, cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 } }, timestamp: 0 } as any,
        { role: 'assistant', content: [{ type: 'text', text: 'final' }], stopReason: 'stop', usage: { input: 30, output: 20, cacheRead: 0, cacheWrite: 2, totalTokens: 52, cost: { input: 0.0003, output: 0.0008, cacheRead: 0, cacheWrite: 0, total: 0.0011 } }, timestamp: 0 } as any,
      ] },
    ]);

    const adapter = new ZClaudiaAdapter();
    const out = await collect(adapter, 'hi', {});

    const last = out[out.length - 1];
    expect(last.type).toBe('result');
    expect(last.usage).toMatchObject({ input: 130, output: 70, cacheRead: 5, cacheWrite: 2, totalTokens: 207 });
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

describe('ZClaudiaAdapter.run — thinking', () => {
  beforeEach(() => {
    mockAgentInstances.length = 0;
    scriptQueue.length = 0;
  });

  it('translates thinking_delta into ClaudeMessage.thinking_delta', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'reasoning step' } },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new ZClaudiaAdapter();
    const out = await collect(adapter, 'hi', {});

    const thinkings = out.filter(m => m.type === 'thinking_delta');
    expect(thinkings).toHaveLength(1);
    expect((thinkings[0] as any).thinkingContent).toBe('reasoning step');
  });

  it('captures thinkingSignature from thinking_end content', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'reasoning' } },
      { type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'reasoning', thinkingSignature: 'sig-abc' }] },
        assistantMessageEvent: { type: 'thinking_end', contentIndex: 0, content: 'reasoning',
          partial: { role: 'assistant', content: [{ type: 'thinking', thinking: 'reasoning', thinkingSignature: 'sig-abc' }] }
        }
      },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new ZClaudiaAdapter();
    const out = await collect(adapter, 'hi', {});

    const thinkings = out.filter(m => m.type === 'thinking_delta');
    const sigEvent = thinkings.find(t => (t as any).thinkingSignature);
    expect(sigEvent).toBeDefined();
    expect((sigEvent as any).thinkingSignature).toBe('sig-abc');
  });
});

describe('ZClaudiaAdapter.run — tool loop integration', () => {
  beforeEach(() => {
    mockAgentInstances.length = 0;
    scriptQueue.length = 0;
  });

  it('full single-tool turn: emits tool_use, tool_activity, tool_result, then assistant + result', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'calling read' } },
      { type: 'message_end', message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'calling read' },
          { type: 'toolCall', id: 't1', name: 'read', arguments: { path: '/x' } },
        ],
      } },
      { type: 'tool_execution_update', toolCallId: 't1', toolName: 'read', args: {}, partialResult: { content: [{ type: 'text', text: 'reading...' }] } },
      { type: 'tool_execution_end', toolCallId: 't1', toolName: 'read', result: { content: [{ type: 'text', text: 'file body' }] }, isError: false },
      { type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'it says foo' } },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new ZClaudiaAdapter();
    const out = await collect(adapter, 'read /x', {});

    const types = out.map(m => m.type);
    expect(types[0]).toBe('init');
    expect(types).toContain('tool_use');
    expect(types).toContain('tool_activity');
    expect(types).toContain('tool_result');
    expect(types.filter(t => t === 'assistant').length).toBeGreaterThanOrEqual(2);
    expect(types[types.length - 1]).toBe('result');
  });

  it('passes tools array to pi Agent constructor', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new ZClaudiaAdapter();
    await collect(adapter, 'hi', { cwd: '/tmp' });

    expect(mockAgentInstances.length).toBe(1);
    expect((mockAgentInstances[0].initialState as any).tools).toBeDefined();
    expect((mockAgentInstances[0].initialState as any).tools.length).toBe(7);
  });

  it('passes 3 hooks to pi Agent constructor', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new ZClaudiaAdapter();
    await collect(adapter, 'hi', {});

    expect(mockAgentInstances.length).toBe(1);
    const opts = mockAgentInstances[0].constructorOpts;
    expect(opts.beforeToolCall).toBeDefined();
    expect(opts.afterToolCall).toBeDefined();
    expect(opts.shouldStopAfterTurn).toBeDefined();
  });
});

describe('buildModel — modelOverride', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = { ...originalEnv }; });

  it('uses modelOverride when provided (openai-compatible path)', () => {
    process.env.OPENAI_BASE_URL = 'http://localhost:3000/v1';
    const { model } = buildModel(undefined, 'kimi-k2.6');
    expect(model.id).toBe('kimi-k2.6');
  });

  it('uses modelOverride for built-in provider path', () => {
    delete process.env.OPENAI_BASE_URL;
    const { model } = buildModel(undefined, 'custom-claude-id');
    expect(model.id).toBe('custom-claude-id');
  });

  it('falls back to env-driven model when no override', () => {
    process.env.OPENAI_BASE_URL = 'http://localhost:3000/v1';
    process.env.OPENAI_MODEL = 'env-model';
    const { model } = buildModel(undefined);
    expect(model.id).toBe('env-model');
  });
});

describe('ZClaudiaAdapter.run — agent profile fields wired into Agent', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv };
    mockAgentInstances.length = 0;
    scriptQueue.length = 0;
  });
  afterEach(() => { process.env = { ...originalEnv }; });

  it('passes options.thinkingLevel into Agent initialState', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new ZClaudiaAdapter();
    await collect(adapter, 'hi', { thinkingLevel: 'medium' as ThinkingLevel });

    expect(mockAgentInstances[0].initialState.thinkingLevel).toBe('medium');
  });

  it('passes options.enabledTools to buildTools (filters to subset)', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new ZClaudiaAdapter();
    await collect(adapter, 'hi', { enabledTools: ['read', 'bash'] as ToolName[] });

    expect((mockAgentInstances[0].initialState as any).tools).toBeDefined();
    expect((mockAgentInstances[0].initialState as any).tools.length).toBe(2);
    expect((mockAgentInstances[0].initialState as any).tools.map((t: any) => t.name).sort()).toEqual(['bash', 'read']);
  });

  it('passes options.agentProfile.model into buildModel as override', async () => {
    process.env.OPENAI_BASE_URL = 'http://localhost:3000/v1';
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const agentProfile: AgentProfileConfig = {
      id: 'a1', name: 'coder', llmProfileId: 'lp1', model: 'kimi-k2.6',
      systemPrompt: '', enabledTools: ['read'], createdAt: 0, updatedAt: 0,
    };
    const adapter = new ZClaudiaAdapter();
    await collect(adapter, 'hi', { agentProfile });

    expect(mockAgentInstances[0].initialState.model.id).toBe('kimi-k2.6');
  });
});

describe('buildModel — profile overrides', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses profile providerType and apiKey when supplied (built-in provider path)', () => {
    delete process.env.OPENAI_BASE_URL;
    const profile: LlmProfileConfig = {
      id: 'p1',
      name: 'claude-personal',
      providerType: 'anthropic',
      apiKey: 'sk-ant-from-profile',
      createdAt: 0,
      updatedAt: 0,
    };
    const { model, getApiKey } = buildModel(profile);
    expect(model.provider).toBe('anthropic');
    expect(getApiKey).toBeDefined();
  });

  it('uses profile baseUrl + compat when supplied (openai-compatible path)', () => {
    const profile: LlmProfileConfig = {
      id: 'p2',
      name: 'deepseek',
      providerType: 'openai-custom',
      baseUrl: 'http://127.0.0.1:3000/v1',
      apiKey: 'sk-deepseek',
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
      createdAt: 0,
      updatedAt: 0,
    };
    const { model, getApiKey } = buildModel(profile);
    expect(model.baseUrl).toBe('http://127.0.0.1:3000/v1');
    expect(model.api).toBe('openai-completions');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((model as any).compat).toEqual({ supportsDeveloperRole: false, supportsReasoningEffort: false });
    expect(getApiKey).toBeDefined();
  });

  it('falls back to env when profile is undefined (regression: sub-project 1 behavior)', () => {
    delete process.env.OPENAI_BASE_URL;
    process.env.PI_PROVIDER = 'anthropic';
    process.env.PI_MODEL = 'claude-sonnet-4-6';
    const { model } = buildModel(undefined);
    expect(model.provider).toBe('anthropic');
  });

  it('profile.apiKey overrides env (even if env is set)', async () => {
    process.env.OPENAI_BASE_URL = 'http://127.0.0.1:3000/v1';
    process.env.OPENAI_API_KEY = 'env-key';
    const profile: LlmProfileConfig = {
      id: 'p3',
      name: 'p3',
      providerType: 'openai-custom',
      baseUrl: 'http://127.0.0.1:4000/v1',
      apiKey: 'profile-key',
      createdAt: 0,
      updatedAt: 0,
    };
    const { model, getApiKey } = buildModel(profile);
    expect(model.baseUrl).toBe('http://127.0.0.1:4000/v1');
    expect(await getApiKey!('openai-custom')).toBe('profile-key');
  });
});

describe('ZClaudiaAdapter.run — steering wiring', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv };
    mockAgentInstances.length = 0;
    scriptQueue.length = 0;
  });
  afterEach(() => { process.env = { ...originalEnv }; });

  it('constructs Agent with steeringMode: "all"', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);
    const adapter = new ZClaudiaAdapter();
    await collect(adapter, 'hi', {});
    expect(mockAgentInstances[0].constructorOpts.steeringMode).toBe('all');
  });

  it('invokes options.onAgentReady once synchronously after Agent construction with a SteerHandle', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);
    const adapter = new ZClaudiaAdapter();
    const handles: SteerHandle[] = [];
    await collect(adapter, 'hi', { onAgentReady: (h) => handles.push(h) });
    expect(handles).toHaveLength(1);
    expect(typeof handles[0].steer).toBe('function');
  });

  it('handle.steer forwards to the live pi Agent.steer', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);
    const adapter = new ZClaudiaAdapter();
    let handle: SteerHandle | undefined;
    await collect(adapter, 'hi', { onAgentReady: (h) => { handle = h; } });
    const msg: AgentMessage = { role: 'user', content: [{ type: 'text', text: 'also fix typo' }] } as AgentMessage;
    handle!.steer(msg);
    expect(mockAgentInstances[0].steerCalls).toContainEqual(msg);
  });

  it('bridges turn_start event to options.onSteerConsumed', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'turn_start' },
      { type: 'agent_end', messages: [] },
    ]);
    const adapter = new ZClaudiaAdapter();
    const consumedCalls: number[] = [];
    await collect(adapter, 'hi', { onSteerConsumed: () => consumedCalls.push(Date.now()) });
    expect(consumedCalls).toHaveLength(1);
  });

  it('declares session.steer capability', () => {
    const adapter = new ZClaudiaAdapter();
    const cap = adapter.manifest.capabilities.find((c) => c.id === 'session.steer');
    expect(cap).toBeDefined();
    expect(cap?.supported).toBe(true);
  });
});
