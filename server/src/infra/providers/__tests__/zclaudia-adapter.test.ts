import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core';
import { __testables, resolvePlanModeTools, PiAgentProviderAdapter } from '../pi-agent/adapter.js';
import type { RunOptions, ProviderRuntimeEvent, SteerHandle } from '../types.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { AgentProfileConfig, ThinkingLevel } from '@zclaudia/shared/core/agent-profile';
import { ALL_TOOL_NAMES, type ToolName } from '@zclaudia/shared/core/tools';

// Mock sandbox so resolvePlanModeTools tests can control isSandboxAvailable()
// without touching real system dependencies (sysbox/bwrap presence checks).
vi.mock('../pi-runtime/sandbox.js', () => ({
  isSandboxAvailable: vi.fn(() => false),
  ensureSandboxInitialized: vi.fn(() => Promise.resolve()),
  __resetSandboxCacheForTests: vi.fn(),
}));

// Mock pi-ai's registry helpers so tests don't hit the real model registry.
// The new buildModel calls getModel for same-provider lookup, then
// getProviders + getModels for cross-provider sweep. The mock returns a
// registry-shaped Model for any non-pathological (provider, modelId) pair so
// existing assertions about contextWindow=200_000 still hold; getProviders
// returns the known providers so cross-provider sweep can iterate; getModels
// returns the entry only when the provider+id pair would have hit getModel.
vi.mock('@earendil-works/pi-ai', async () => {
  const actual = await vi.importActual<typeof import('@earendil-works/pi-ai')>('@earendil-works/pi-ai');
  const KNOWN_PROVIDERS = ['anthropic', 'openai', 'deepseek'];
  function buildEntry(provider: string, model: string) {
    return { provider, id: model, contextWindow: 200000, maxTokens: 8000, input: ['text', 'image'] };
  }
  return {
    getModel: vi.fn((provider: string, model: string) => {
      if (provider === 'unknown') throw new Error(`unknown provider: ${provider}`);
      if (model === 'invalid-model') throw new Error(`unknown model: ${model}`);
      // Registry-style "not found": return undefined for an ad-hoc
      // "unregistered" id so the new buildModel falls back to the
      // openai-compat literal path. Existing tests pass concrete model ids
      // (e.g. claude-sonnet-4-6) which we treat as registered.
      if (model.startsWith('unregistered-')) return undefined;
      return buildEntry(provider, model);
    }),
    getProviders: vi.fn(() => KNOWN_PROVIDERS),
    getModels: vi.fn((provider: string) => {
      // The mock's getModel returns a hit for any non-`unregistered-` id, so
      // we don't need an exhaustive enumeration here — return a tiny
      // stand-in list for cross-provider sweeps. Tests that need specific
      // cross-provider hits create them via build-model unit tests that
      // override the mock.
      if (!KNOWN_PROVIDERS.includes(provider)) return [];
      return [buildEntry(provider, `registered-${provider}-model`)];
    }),
    // Re-export the real createAssistantMessageEventStream so retry-stream.ts
    // (which is a real module in the import graph) works correctly in tests.
    createAssistantMessageEventStream: actual.createAssistantMessageEventStream,
    streamSimple: vi.fn(() => {
      const stream = actual.createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: 'stop', message: { role: 'assistant', content: [], stopReason: 'stop' } } as never);
      stream.end();
      return stream;
    }),
  };
});

// Hoisted collections used inside vi.mock factory.
const { mockAgentInstances, scriptQueue } = vi.hoisted(() => ({
  mockAgentInstances: [] as Array<{
    initialState: { systemPrompt: string; model: unknown; messages: unknown[]; tools?: unknown[] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructorOpts: any;
    promptCalls: Array<{ input: string; images?: unknown[] }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    steerCalls: any[];
  }>,
  // `waitForPromise` lets tests gate agent.prompt() resolution until an
  // async condition is satisfied (e.g. waiting for a retry timer to fire).
  scriptQueue: [] as Array<{ events: AgentEvent[]; rejectWith?: Error; waitForPromise?: Promise<void> }>,
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
    async prompt(input: string, images?: unknown[]): Promise<void> {
      this.slot.promptCalls.push({ input, images });
      const script = scriptQueue.shift() ?? { events: [] };
      // Yield once so the adapter's for-await loop has started consuming.
      await Promise.resolve();
      for (const event of script.events) {
        this.listener?.(event);
        // Give the queue a microtask between events so consumers can interleave.
        await Promise.resolve();
      }
      // Optional gate: lets tests delay queue.close() until an async condition
      // is met (e.g. a retry timer fired and pushed retry_scheduled).
      if (script.waitForPromise) await script.waitForPromise;
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
function scriptNextAgent(events: AgentEvent[], options?: { rejectWith?: Error; waitForPromise?: Promise<void> }) {
  scriptQueue.push({ events, rejectWith: options?.rejectWith, waitForPromise: options?.waitForPromise });
}

const { AsyncQueue, buildModel, translateEvent, extractErrorStop, extractLastCallUsage } = __testables;

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

describe('extractErrorStop', () => {
  it('returns errorMessage when final assistant message stopReason is error', () => {
    const out = extractErrorStop([
      { role: 'user', content: 'hi', timestamp: 0 } as any,
      { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'HTTP 503 model_not_found', timestamp: 0 } as any,
    ]);
    expect(out).toBe('HTTP 503 model_not_found');
  });

  it('returns undefined when final assistant message stopped normally', () => {
    const out = extractErrorStop([
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop', timestamp: 0 } as any,
    ]);
    expect(out).toBeUndefined();
  });

  it('only inspects the LAST assistant message (mid-turn tool errors stay invisible)', () => {
    const out = extractErrorStop([
      { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'first call failed', timestamp: 0 } as any,
      { role: 'tool', content: [], timestamp: 0 } as any,
      { role: 'assistant', content: [{ type: 'text', text: 'recovered' }], stopReason: 'stop', timestamp: 0 } as any,
    ]);
    expect(out).toBeUndefined();
  });

  it('returns fallback message when stopReason=error but errorMessage missing', () => {
    const out = extractErrorStop([
      { role: 'assistant', content: [], stopReason: 'error', timestamp: 0 } as any,
    ]);
    expect(out).toBe('LLM provider returned an error stop reason');
  });

  it('returns undefined for empty / no-assistant message list', () => {
    expect(extractErrorStop([])).toBeUndefined();
    expect(extractErrorStop([{ role: 'user', content: 'hi', timestamp: 0 } as any])).toBeUndefined();
  });
});

describe('extractLastCallUsage', () => {
  it('returns the LAST assistant message usage on a multi-call turn', () => {
    const messages = [
      { role: 'assistant', content: [], usage: { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 1100 }, timestamp: 0 } as any,
      { role: 'tool', content: [], timestamp: 0 } as any,
      { role: 'assistant', content: [], usage: { input: 1200, output: 80, cacheRead: 300, cacheWrite: 0, totalTokens: 1580 }, timestamp: 0 } as any,
    ];
    const result = extractLastCallUsage(messages);
    expect(result).toMatchObject({ input: 1200, cacheRead: 300 });
    // Must NOT be the first assistant message's usage
    expect(result?.input).not.toBe(1000);
  });

  it('skips assistant messages without a usage block and returns an earlier one that has it', () => {
    const messages = [
      { role: 'assistant', content: [], usage: { input: 500, output: 50, cacheRead: 10, cacheWrite: 0, totalTokens: 560 }, timestamp: 0 } as any,
      { role: 'tool', content: [], timestamp: 0 } as any,
      // Last assistant message has no usage block
      { role: 'assistant', content: [{ type: 'text', text: 'done' }], timestamp: 0 } as any,
    ];
    const result = extractLastCallUsage(messages);
    expect(result).toMatchObject({ input: 500, cacheRead: 10 });
  });

  it('returns undefined when no assistant message carries a usage block', () => {
    const messages = [
      { role: 'user', content: 'hi', timestamp: 0 } as any,
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }], timestamp: 0 } as any,
    ];
    expect(extractLastCallUsage(messages)).toBeUndefined();
  });

  it('returns undefined for an empty message list', () => {
    expect(extractLastCallUsage([])).toBeUndefined();
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
    // build-model no longer reads OPENAI_API_KEY from env for a profile-less
    // model; getApiKey is undefined and pi-ai owns env resolution.
    expect(getApiKey).toBeUndefined();
  });

  it('OPENAI_BASE_URL custom model with no profile: getApiKey is undefined (pi-ai owns env)', () => {
    process.env.OPENAI_BASE_URL = 'https://example.com/v1';
    process.env.OPENAI_API_KEY = 'sk-real-key';
    const { getApiKey } = buildModel();
    expect(getApiKey).toBeUndefined();
  });

  it('credential comes from the profile, never env: profile.apiKey wins and env is ignored', async () => {
    process.env.OPENAI_BASE_URL = 'https://example.com/v1';
    process.env.OPENAI_API_KEY = 'sk-env-should-be-ignored';
    const { getApiKey } = buildModel({
      id: 'p1', name: 'P', providerType: 'openai',
      baseUrl: 'https://example.com/v1', apiKey: 'sk-from-profile',
      createdAt: 0, updatedAt: 0,
    } as any);
    expect(await getApiKey!('whatever')).toBe('sk-from-profile');
  });

  it('OPENAI_BASE_URL custom model: reasoning is true so pi enables thinking-format-specific knobs', () => {
    // pi-ai's openai-completions provider gates thinkingFormat-specific
    // "enable thinking" knobs on `model.reasoning`. Hardcoding false here
    // would silently break thinking for deepseek / zai / qwen / openrouter
    // / together regardless of agentProfile.thinkingLevel.
    process.env.OPENAI_BASE_URL = 'https://api.deepseek.com/v1';
    const { model } = buildModel();
    expect(model.reasoning).toBe(true);
  });
});

describe('resolvePlanModeTools', () => {
  const ALL = ['Read', 'Grep', 'Glob', 'LS', 'Bash', 'Write', 'Edit'] as ToolName[];

  it('plan mode includes Bash when sandbox available', () => {
    expect(resolvePlanModeTools(ALL, true, true)).toContain('Bash');
  });

  it('plan mode excludes Bash when sandbox unavailable', () => {
    expect(resolvePlanModeTools(ALL, true, false)).not.toContain('Bash');
  });

  it('plan mode still excludes non-read-only tools (Write/Edit)', () => {
    const r = resolvePlanModeTools(ALL, true, true);
    expect(r).not.toContain('Write');
    expect(r).not.toContain('Edit');
  });

  it('non-plan mode returns tools unchanged', () => {
    expect(resolvePlanModeTools(ALL, false, true)).toEqual(ALL);
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

async function collect(adapter: PiAgentProviderAdapter, input: string, options: Partial<RunOptions>): Promise<ProviderRuntimeEvent[]> {
  const opts: RunOptions = {
    cwd: '/tmp',
    sessionId: 'sess-test',
    ...options,
  } as RunOptions;
  const out: ProviderRuntimeEvent[] = [];
  for await (const m of adapter.run(input, opts, async () => ({ behavior: 'allow' }))) {
    out.push(m);
  }
  return out;
}

describe('PiAgentProviderAdapter.run', () => {
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

    const adapter = new PiAgentProviderAdapter();
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

    const adapter = new PiAgentProviderAdapter();
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

    const adapter = new PiAgentProviderAdapter();
    await collect(adapter, 'follow up', { db, claudiaSessionId: 'sess-test' });

    expect(mockAgentInstances.length).toBe(1);
    const initialMessages = mockAgentInstances[0].initialState.messages;
    expect(initialMessages.map((m: any) => m.role)).toEqual(['user', 'assistant']);
    expect((initialMessages[0] as any).content).toBe('prev question');
    expect(mockAgentInstances[0].promptCalls[0].input).toBe('follow up');
  });

  it('config error (getModel throws): yields init then error(isComplete) and stops', async () => {
    process.env.PI_MODEL = 'invalid-model';
    const adapter = new PiAgentProviderAdapter();
    const out = await collect(adapter, 'hi', {});
    delete process.env.PI_MODEL;

    expect(out.map(m => m.type)).toEqual(['init', 'error']);
    expect(out[1].isComplete).toBe(true);
    expect(out[1].error).toMatch(/unknown model/);
  });

  it('error-path init reports the env-resolved model id (OPENAI_MODEL), not the hardcoded default', async () => {
    const prevPi = process.env.PI_MODEL;
    const prevOpenai = process.env.OPENAI_MODEL;
    delete process.env.PI_MODEL;
    process.env.OPENAI_MODEL = 'invalid-model'; // mock getModel throws → buildModel throws
    try {
      const adapter = new PiAgentProviderAdapter();
      const out = await collect(adapter, 'hi', {});
      expect(out.map(m => m.type)).toEqual(['init', 'error']);
      // The badge must reflect the model that actually failed, not claude-sonnet-4-6.
      expect(out[0].systemInfo?.model).toBe('invalid-model');
    } finally {
      if (prevPi === undefined) delete process.env.PI_MODEL; else process.env.PI_MODEL = prevPi;
      if (prevOpenai === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = prevOpenai;
    }
  });

  it('LLM error: yields error(isComplete) at end of stream', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
    ], { rejectWith: new Error('Anthropic 429') });

    const adapter = new PiAgentProviderAdapter();
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

    const adapter = new PiAgentProviderAdapter();
    const out = await collect(adapter, 'hi', { db: brokenDb, claudiaSessionId: 'sess-test' });

    const errors = out.filter(m => m.type === 'error');
    expect(errors.length).toBe(1);
    expect(errors[0].isComplete).toBeFalsy();
    expect(out[out.length - 1].type).toBe('result');
    expect(mockAgentInstances[0].initialState.messages).toEqual([]);
  });

  it('swallowed LLM error (stopReason=error in agent_end): yields error and skips result', async () => {
    // pi-agent-core treats stream `error` and `done` reasons identically and
    // emits message_end for both — the only signal left is stopReason=error on
    // the final assistant message. Adapter must surface that as an explicit
    // error event so the run shows "LLM call failed: …" instead of "completed
    // empty in 120ms".
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'HTTP 503 model_not_found', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: 0 } as any,
      ] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    const out = await collect(adapter, 'hi', {});

    expect(out.map(m => m.type)).toEqual(['init', 'error']);
    const err = out[1];
    expect(err.error).toContain('LLM call failed');
    expect(err.error).toContain('HTTP 503 model_not_found');
    expect(err.isComplete).toBe(true);
  });

  it('unknown pi event types do not break stream', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: '_future_' as any },
      { type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'text_delta', delta: 'a' } },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    const out = await collect(adapter, 'hi', {});

    expect(out.map(m => m.type)).toEqual(['init', 'assistant', 'result']);
  });

  it('translates mode "plan" to systemInfo.permissionMode "plan"', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    const out = await collect(adapter, 'hi', { mode: 'plan' });

    const init = out.find(m => m.type === 'init');
    expect(init?.systemInfo?.permissionMode).toBe('plan');
  });

  it('defaults permissionMode to "default" when mode is missing / non-plan', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    const out = await collect(adapter, 'hi', {});

    const init = out.find(m => m.type === 'init');
    expect(init?.systemInfo?.permissionMode).toBe('default');
  });

  it('emits the model registry context window in init systemInfo', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    const out = await collect(adapter, 'hi', {
      agentProfile: {
        model: 'claude-sonnet-4-6',
        systemPrompt: '',
        enabledTools: [],
      } as any,
    });

    const init = out.find(m => m.type === 'init');
    // claude-sonnet-4-6 is found via the mocked pi-ai registry (any non-
    // `unregistered-*` id matches). MODEL_CONTEXT_WINDOWS was retired in
    // F4 — pi_ai_registry is now the canonical source.
    expect(init?.systemInfo?.contextWindow).toBe(200_000);
    expect(init?.systemInfo?.contextWindowSource).toBe('pi_ai_registry');
    expect(init?.systemInfo?.contextWindowMatchedProvider).toBe('anthropic');
  });

  it('reports the agent profile model in init systemInfo (not the env/default fallback)', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const prevEnv = process.env.PI_MODEL;
    delete process.env.PI_MODEL;
    try {
      const adapter = new PiAgentProviderAdapter();
      const out = await collect(adapter, 'hi', {
        agentProfile: {
          model: 'kimi-k2.6',
          systemPrompt: '',
          enabledTools: [],
        } as any,
        llmProfileConfig: {
          id: 'lp', name: 'p', providerType: 'openai',
          baseUrl: 'http://example.local/v1',
          createdAt: 0, updatedAt: 0,
        } as any,
      });
      const init = out.find(m => m.type === 'init');
      expect(init?.systemInfo?.model).toBe('kimi-k2.6');
    } finally {
      if (prevEnv !== undefined) process.env.PI_MODEL = prevEnv;
    }
  });

  it('reports contextWindowSource=profile_entry when models[*].contextWindow is set', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    const out = await collect(adapter, 'hi', {
      agentProfile: {
        model: 'claude-sonnet-4-6',
        systemPrompt: '',
        enabledTools: [],
      } as any,
      llmProfileConfig: {
        id: 'lp', name: 'p', providerType: 'anthropic',
        models: [{ modelId: 'claude-sonnet-4-6', contextWindow: 1_000_000 }],
        createdAt: 0, updatedAt: 0,
      } as any,
    });

    const init = out.find(m => m.type === 'init');
    expect(init?.systemInfo?.contextWindow).toBe(1_000_000);
    expect(init?.systemInfo?.contextWindowSource).toBe('profile_entry');
  });

  it('reports contextWindowSource=pi_ai_registry when only the registry resolves', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    const out = await collect(adapter, 'hi', {
      agentProfile: {
        // The mocked pi-ai getModel returns contextWindow=200_000 for any
        // non-`unregistered-*` id, so resolution lands on the pi_ai_registry
        // layer with matchedProvider = the configured providerType.
        model: 'some-unlisted-model',
        systemPrompt: '',
        enabledTools: [],
      } as any,
    });

    const init = out.find(m => m.type === 'init');
    expect(init?.systemInfo?.contextWindow).toBe(200_000);
    expect(init?.systemInfo?.contextWindowSource).toBe('pi_ai_registry');
  });

  it('plan mode filters enabledTools to read-only subset', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    const out = await collect(adapter, 'hi', {
      mode: 'plan',
      enabledTools: [
        'read',
        'write',
        'edit',
        'bash',
        'grep',
        'find',
        'Glob',
        'ls',
        'TodoWrite',
        'AskUserQuestion',
        'WebFetch',
        'WebSearch',
        'MCPTool',
        'ToolSearch',
        'ListMcpResources',
        'ReadMcpResource',
        'TaskOutput',
        'Agent',
        'LSPTool',
      ] as ToolName[],
    });

    const init = out.find(m => m.type === 'init');
    expect(init?.systemInfo?.tools).toEqual([
      'Read',
      'Grep',
      'Glob',
      'LS',
      'TodoWrite',
      'AskUserQuestion',
      'WebFetch',
      'WebSearch',
      'ToolSearch',
      'ListMcpResources',
      'ReadMcpResource',
      'TaskOutput',
      'LSPTool',
    ]);

    // Agent should have been constructed with only the RO tools too.
    const constructed = mockAgentInstances[0]?.initialState?.tools as Array<{ name: string }> | undefined;
    const toolNames = (constructed ?? []).map((t) => t.name);
    expect(toolNames).toEqual([
      'Read',
      'Grep',
      'Glob',
      'LS',
      'TodoWrite',
      'AskUserQuestion',
      'WebFetch',
      'WebSearch',
      'ToolSearch',
      'ListMcpResources',
      'ReadMcpResource',
      'TaskOutput',
      'LSPTool',
    ]);
  });

  it('non-plan mode passes enabledTools through unfiltered', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    const out = await collect(adapter, 'hi', {
      enabledTools: ['read', 'write', 'bash'] as ToolName[],
    });

    const init = out.find(m => m.type === 'init');
    expect(init?.systemInfo?.tools).toEqual(['Read', 'Write', 'Bash']);
  });

  it('plan mode preserves intersection with restrictive agent profile (read-only ∩ enabled)', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    const out = await collect(adapter, 'hi', {
      mode: 'plan',
      enabledTools: ['read', 'write'] as ToolName[],  // agent only allows read + write
    });

    const init = out.find(m => m.type === 'init');
    // write filtered out; read kept
    expect(init?.systemInfo?.tools).toEqual(['Read']);
  });

  it('plan mode appends PLAN mode suffix to systemPrompt', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    await collect(adapter, 'hi', {
      mode: 'plan',
      systemPrompt: 'You are a coding assistant.',
    });

    const prompt = mockAgentInstances[0]?.initialState?.systemPrompt as string;
    expect(prompt).toContain('You are a coding assistant.');
    expect(prompt).toContain('PLAN mode');
    expect(prompt).toContain('read-only');
  });

  it('non-plan mode leaves systemPrompt untouched', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    await collect(adapter, 'hi', {
      systemPrompt: 'You are a coding assistant.',
    });

    const prompt = mockAgentInstances[0]?.initialState?.systemPrompt as string;
    expect(prompt).toBe('You are a coding assistant.');
    expect(prompt).not.toContain('PLAN mode');
  });
});

describe('PiAgentProviderAdapter.run — thinking', () => {
  beforeEach(() => {
    mockAgentInstances.length = 0;
    scriptQueue.length = 0;
  });

  it('translates thinking_delta into ProviderRuntimeEvent.thinking_delta', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'reasoning step' } },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
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

    const adapter = new PiAgentProviderAdapter();
    const out = await collect(adapter, 'hi', {});

    const thinkings = out.filter(m => m.type === 'thinking_delta');
    const sigEvent = thinkings.find(t => (t as any).thinkingSignature);
    expect(sigEvent).toBeDefined();
    expect((sigEvent as any).thinkingSignature).toBe('sig-abc');
  });
});

describe('PiAgentProviderAdapter.run — tool loop integration', () => {
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

    const adapter = new PiAgentProviderAdapter();
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

    const adapter = new PiAgentProviderAdapter();
    await collect(adapter, 'hi', { cwd: '/tmp' });

    expect(mockAgentInstances.length).toBe(1);
    expect((mockAgentInstances[0].initialState as any).tools).toBeDefined();
    // Memory is skipped when memoryDir is absent (no project context here), so
    // the built tool count is one less than the full canonical list.
    expect((mockAgentInstances[0].initialState as any).tools.length).toBe(ALL_TOOL_NAMES.length - 1);
  });

  it('adds external discovery meta tools when external tool state is present', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    await collect(adapter, 'hi', {
      cwd: '/tmp/project',
      claudiaSessionId: 'session-1',
      db: createTestDb(),
      enabledTools: ['Read'],
      externalToolState: {
        discoverableProviders: [{ source: 'mcp', serverId: 'github' }],
        pinnedExternalTools: [],
        loadedExternalTools: [],
      },
    } as RunOptions);

    const toolNames = ((mockAgentInstances.at(-1)?.initialState as any).tools ?? []).map((tool: any) => tool.name);
    expect(toolNames).toEqual(expect.arrayContaining([
      'Read',
      'ListExternalToolProviders',
      'SearchExternalTools',
      'InspectExternalTool',
      'LoadExternalTool',
    ]));
  });

  it('adds skill meta tools and active skill context when skill state is present', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    const out = await collect(adapter, 'hi', {
      cwd: '/tmp/project',
      enabledTools: ['Read'],
      skillState: {
        discoverableSkills: [
          {
            id: 'design-spec',
            name: 'design-spec',
            description: 'Write technical design specs',
            source: 'workspace',
            filePath: '/tmp/skills/design-spec/SKILL.md',
            dirPath: '/tmp/skills/design-spec',
          },
        ],
        pinnedSkills: [],
        loadedSkills: [{ source: 'workspace', id: 'design-spec' }],
        loadedSkillContents: {
          'workspace:design-spec': '# Design Spec\nFollow the TDS workflow.',
        },
      },
    } as RunOptions);

    const instance = mockAgentInstances.at(-1);
    const toolNames = ((instance?.initialState as any).tools ?? []).map((tool: any) => tool.name);
    const initTools = (out[0] as any).systemInfo.tools;
    expect(toolNames).toEqual(expect.arrayContaining([
      'Read',
      'ListSkills',
      'SearchSkills',
      'InspectSkill',
      'LoadSkill',
      'RunSkill',
    ]));
    expect(initTools).toEqual(expect.arrayContaining([
      'Read',
      'ListSkills',
      'SearchSkills',
      'InspectSkill',
      'LoadSkill',
      'RunSkill',
    ]));
    expect((instance?.initialState as any).systemPrompt).toContain('Discoverable skills');
    expect((instance?.initialState as any).systemPrompt).toContain('Active session skills');
    expect((instance?.initialState as any).systemPrompt).toContain('Follow the TDS workflow.');
  });

  it('passes 3 hooks to pi Agent constructor', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
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

describe('PiAgentProviderAdapter.run — agent profile fields wired into Agent', () => {
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

    const adapter = new PiAgentProviderAdapter();
    await collect(adapter, 'hi', { thinkingLevel: 'medium' as ThinkingLevel });

    expect(mockAgentInstances[0].initialState.thinkingLevel).toBe('medium');
  });

  it('passes options.enabledTools to buildTools (filters to subset)', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    await collect(adapter, 'hi', { enabledTools: ['read', 'bash'] as ToolName[] });

    expect((mockAgentInstances[0].initialState as any).tools).toBeDefined();
    expect((mockAgentInstances[0].initialState as any).tools.length).toBe(2);
    expect((mockAgentInstances[0].initialState as any).tools.map((t: any) => t.name).sort()).toEqual(['Bash', 'Read']);
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
    const adapter = new PiAgentProviderAdapter();
    await collect(adapter, 'hi', { agentProfile });

    expect(mockAgentInstances[0].initialState.model.id).toBe('kimi-k2.6');
  });
});

describe('buildModel — modelEntry overrides', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = { ...originalEnv }; });

  it('overrides contextWindow on openai-compat literal path (unregistered id)', () => {
    const profile = {
      providerType: 'openai',
      baseUrl: 'http://x/v1',
      apiKey: 'k',
    } as any;
    // `unregistered-*` ids miss both same-provider and cross-provider
    // lookups in the mock, so buildModel falls back to the openai-compat
    // literal — and the modelEntry override still wins.
    const built = buildModel(profile, 'unregistered-x', { modelId: 'unregistered-x', contextWindow: 999_999 });
    expect(built.model.contextWindow).toBe(999_999);
  });

  it('overrides maxTokens on openai-compat literal path', () => {
    const built = buildModel(
      { providerType: 'openai', baseUrl: 'http://x/v1' } as any,
      'unregistered-m',
      { modelId: 'unregistered-m', maxTokens: 2048 },
    );
    expect(built.model.maxTokens).toBe(2048);
  });

  it('replaces display name on openai-compat literal path', () => {
    const built = buildModel(
      { providerType: 'openai', baseUrl: 'http://x/v1' } as any,
      'unregistered-raw-id',
      { modelId: 'unregistered-raw-id', displayName: 'Pretty Name' },
    );
    expect(built.model.name).toBe('Pretty Name');
  });

  it('overrides registry-resolved Model.contextWindow', () => {
    delete process.env.OPENAI_BASE_URL;
    const built = buildModel(undefined, 'claude-opus-4-7', { modelId: 'claude-opus-4-7', contextWindow: 1_000_000 });
    expect(built.model.contextWindow).toBe(1_000_000);
  });

  it('leaves model untouched when entry is undefined', () => {
    delete process.env.OPENAI_BASE_URL;
    const built = buildModel(undefined, 'claude-opus-4-7');
    expect(built.model.contextWindow).toBeGreaterThan(0); // whatever pi-ai default
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
      providerType: 'openai',
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
      providerType: 'openai',
      baseUrl: 'http://127.0.0.1:4000/v1',
      apiKey: 'profile-key',
      createdAt: 0,
      updatedAt: 0,
    };
    const { model, getApiKey } = buildModel(profile);
    expect(model.baseUrl).toBe('http://127.0.0.1:4000/v1');
    expect(await getApiKey!('openai')).toBe('profile-key');
  });

  it('OpenAI-compat: profile.requestHeaders flow into model.headers', () => {
    const profile = {
      providerType: 'openai',
      baseUrl: 'https://custom.example.com/v1',
      apiKey: 'sk-x',
      requestHeaders: { 'X-Org-Id': 'abc', 'X-Trace': 'xyz' },
    } as any;
    const { model } = buildModel(profile);
    expect(model.headers).toEqual({ 'X-Org-Id': 'abc', 'X-Trace': 'xyz' });
  });

  it('OpenAI-compat: missing requestHeaders → model.headers undefined', () => {
    const profile = {
      providerType: 'openai',
      baseUrl: 'https://custom.example.com/v1',
      apiKey: 'sk-x',
    } as any;
    const { model } = buildModel(profile);
    expect(model.headers).toBeUndefined();
  });

  it('Registry-resolved: profile.requestHeaders also flow into model.headers', () => {
    // No baseUrl → goes through getModel registry path
    delete process.env.OPENAI_BASE_URL;
    process.env.PI_PROVIDER = 'openai';
    process.env.PI_MODEL = 'gpt-5';
    const profile = {
      providerType: 'openai',
      apiKey: 'sk-x',
      requestHeaders: { 'X-Trace': 'reg-path' },
    } as any;
    const { model } = buildModel(profile);
    expect(model.headers).toEqual({ 'X-Trace': 'reg-path' });
  });

  it('Registry-resolved: requestHeaders from profile A do NOT leak into profile B (registry isolation)', () => {
    delete process.env.OPENAI_BASE_URL;
    process.env.PI_PROVIDER = 'openai';
    process.env.PI_MODEL = 'gpt-5';

    const profileA = { providerType: 'openai', requestHeaders: { 'X-Leak-Test': 'A' } } as any;
    const { model: modelA } = buildModel(profileA);
    expect(modelA.headers).toEqual({ 'X-Leak-Test': 'A' });

    // Profile B has NO requestHeaders — must not inherit profile A's headers
    const profileB = { providerType: 'openai' } as any;
    const { model: modelB } = buildModel(profileB);
    expect(modelB.headers).toBeUndefined();
  });

  it('cross-provider registry hit forces api to match providerType, not the registered entry', () => {
    // Same-provider lookup hits (mock returns a hit for any non-
    // `unregistered-*` id under any provider), so the registry path runs
    // with providerType=openai and api gets stamped as openai-completions
    // even if the registry literal would have come from a different provider.
    const profile = {
      providerType: 'openai',
      baseUrl: 'http://proxy.example.com/v1',
      apiKey: 'k',
    } as any;
    const { model } = buildModel(profile, 'claude-opus-4-7');
    // baseUrl replaced.
    expect(model.baseUrl).toBe('http://proxy.example.com/v1');
    // api forced by providerType regardless of registry hit's native api.
    expect(model.api).toBe('openai-completions');
    // provider also flipped to providerType.
    expect(model.provider).toBe('openai');
    // contextWindow inherited from registry (mock returns 200_000).
    expect(model.contextWindow).toBe(200_000);
  });

  it('falls back to openai-compat literal (128k) when both same-provider and cross-provider lookups miss', () => {
    // `unregistered-*` ids are designed by the mock to miss every lookup.
    const profile = {
      providerType: 'openai',
      baseUrl: 'http://proxy.example.com/v1',
      apiKey: 'k',
    } as any;
    const { model } = buildModel(profile, 'unregistered-fake-id');
    expect(model.id).toBe('unregistered-fake-id');
    expect(model.api).toBe('openai-completions');
    expect(model.baseUrl).toBe('http://proxy.example.com/v1');
    expect(model.contextWindow).toBe(128_000);
  });

  it('anthropic providerType + missing registry → falls through to openai-compat literal too', () => {
    // anthropic with an unregistered id: same-provider miss, cross-provider
    // miss (none of the mocked providers have it), so the openai-compat
    // literal kicks in. The literal stamps api='openai-completions' because
    // the literal builder is generic; resolveContextWindow returns
    // `fallback` 100k in this case (no openai-compat default for anthropic
    // providerType) — but buildModel always produces an openai-compat
    // literal as its terminal fallback, regardless of providerType.
    const profile = {
      providerType: 'anthropic',
      apiKey: 'k',
    } as any;
    const { model } = buildModel(profile, 'unregistered-claude-future');
    expect(model.id).toBe('unregistered-claude-future');
    // Literal's contextWindow is the openai-compat default.
    expect(model.contextWindow).toBe(128_000);
  });
});

describe('PiAgentProviderAdapter.run — steering wiring', () => {
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
    const adapter = new PiAgentProviderAdapter();
    await collect(adapter, 'hi', {});
    expect(mockAgentInstances[0].constructorOpts.steeringMode).toBe('all');
  });

  it('invokes options.onAgentReady once synchronously after Agent construction with a SteerHandle', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);
    const adapter = new PiAgentProviderAdapter();
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
    const adapter = new PiAgentProviderAdapter();
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
    const adapter = new PiAgentProviderAdapter();
    const consumedCalls: number[] = [];
    await collect(adapter, 'hi', { onSteerConsumed: () => consumedCalls.push(Date.now()) });
    expect(consumedCalls).toHaveLength(1);
  });

  it('declares session.steer capability', () => {
    const adapter = new PiAgentProviderAdapter();
    const cap = adapter.manifest.capabilities.find((c) => c.id === 'session.steer');
    expect(cap).toBeDefined();
    expect(cap?.supported).toBe(true);
  });
});

describe('prompt cache wiring', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv };
    mockAgentInstances.length = 0;
    scriptQueue.length = 0;
  });
  afterEach(() => { process.env = { ...originalEnv }; });

  it('wraps streamFn to inject cacheRetention from llm profile', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    await collect(adapter, 'hi', {
      llmProfileConfig: {
        id: 'lp1', name: 'p1', providerType: 'anthropic',
        cacheRetention: 'long',
        createdAt: 0, updatedAt: 0,
      } as any,
    });

    const opts = mockAgentInstances[0].constructorOpts;
    expect(typeof opts.streamFn).toBe('function');
    const { streamSimple } = await import('@earendil-works/pi-ai');
    opts.streamFn({ id: 'm' }, { messages: [] }, { temperature: 0 });
    expect(vi.mocked(streamSimple)).toHaveBeenCalledWith(
      { id: 'm' },
      { messages: [] },
      expect.objectContaining({ temperature: 0, cacheRetention: 'long' }),
    );
  });

  it('wraps streamFn without cacheRetention injection when profile has none', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    await collect(adapter, 'hi', {
      llmProfileConfig: {
        id: 'lp2', name: 'p2', providerType: 'anthropic',
        createdAt: 0, updatedAt: 0,
      } as any,
    });

    // streamFn is now always set (retry wrapper is unconditional).
    expect(typeof mockAgentInstances[0].constructorOpts.streamFn).toBe('function');
    const { streamSimple } = await import('@earendil-works/pi-ai');
    mockAgentInstances[0].constructorOpts.streamFn({ id: 'm' }, { messages: [] }, { temperature: 0 });
    await vi.waitFor(() => {
      expect(vi.mocked(streamSimple)).toHaveBeenCalledWith(
        expect.anything(), expect.anything(),
        expect.not.objectContaining({ cacheRetention: expect.anything() }),
      );
    });
  });

  it('passes the zclaudia session id to the Agent for cache routing', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    await collect(adapter, 'hi', {
      claudiaSessionId: 'sess-cache-1',
    });

    expect(mockAgentInstances[0].constructorOpts.sessionId).toBe('sess-cache-1');
  });

  it('wraps streamFn to inject cacheRetention "none" as explicit opt-out', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    await collect(adapter, 'hi', {
      llmProfileConfig: {
        id: 'lp3', name: 'p3', providerType: 'anthropic',
        cacheRetention: 'none',
        createdAt: 0, updatedAt: 0,
      } as any,
    });

    const opts = mockAgentInstances[0].constructorOpts;
    expect(typeof opts.streamFn).toBe('function');
    const { streamSimple } = await import('@earendil-works/pi-ai');
    opts.streamFn({ id: 'm' }, { messages: [] }, { temperature: 0 });
    expect(vi.mocked(streamSimple)).toHaveBeenCalledWith(
      { id: 'm' },
      { messages: [] },
      expect.objectContaining({ temperature: 0, cacheRetention: 'none' }),
    );
  });
});

describe('stream retry wiring', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv };
    mockAgentInstances.length = 0;
    scriptQueue.length = 0;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('always wraps streamFn (even without cacheRetention)', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    await collect(adapter, 'hi', {
      llmProfileConfig: {
        id: 'lp-no-cache', name: 'p', providerType: 'anthropic',
        createdAt: 0, updatedAt: 0,
      } as any,
    });

    expect(typeof mockAgentInstances[0].constructorOpts.streamFn).toBe('function');
  });

  it('injects cacheRetention through the retry wrapper when configured', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    await collect(adapter, 'hi', {
      llmProfileConfig: {
        id: 'lp-cache', name: 'p', providerType: 'anthropic',
        cacheRetention: 'long',
        createdAt: 0, updatedAt: 0,
      } as any,
    });

    const opts = mockAgentInstances[0].constructorOpts;
    const { streamSimple } = await import('@earendil-works/pi-ai');
    opts.streamFn({ id: 'm' }, { messages: [] }, { temperature: 0 });
    await vi.waitFor(() => {
      expect(vi.mocked(streamSimple)).toHaveBeenCalledWith(
        expect.anything(), expect.anything(),
        expect.objectContaining({ cacheRetention: 'long' }),
      );
    });
  });

  it('does not inject cacheRetention when profile has none', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    await collect(adapter, 'hi', {
      llmProfileConfig: {
        id: 'lp-no-cache2', name: 'p', providerType: 'anthropic',
        createdAt: 0, updatedAt: 0,
      } as any,
    });

    const opts = mockAgentInstances[0].constructorOpts;
    const { streamSimple } = await import('@earendil-works/pi-ai');
    vi.mocked(streamSimple).mockClear();
    opts.streamFn({ id: 'm' }, { messages: [] }, { temperature: 0 });
    await vi.waitFor(() => {
      expect(vi.mocked(streamSimple)).toHaveBeenCalled();
    });
    const callOpts = vi.mocked(streamSimple).mock.calls[0][2];
    expect(callOpts).not.toHaveProperty('cacheRetention');
  });

  it('e2e: retry_scheduled ProviderRuntimeEvent is yielded by adapter when streamFn gets a 429', async () => {
    // The MockAgent never calls constructorOpts.streamFn itself — it fires
    // AgentEvents directly. To observe retry_scheduled in the adapter's yielded
    // output we must keep the adapter's AsyncQueue open until the retry timer fires.
    //
    // Mechanism: scriptNextAgent accepts a `waitForPromise` that the MockAgent
    // awaits before resolving prompt() — which in turn delays queue.close().
    // We resolve that promise AFTER advancing fake timers past the 1s backoff,
    // ensuring retry_scheduled is pushed to (and yielded from) the open queue.
    //
    // streamFn is invoked manually inside onAgentReady (synchronous hook that
    // fires between Agent construction and agent.prompt()). The retry wrapper's
    // onRetry callback pushes retry_scheduled to the queue; because the queue
    // is still open (waitForPromise hasn't resolved yet), collect() yields it.
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const { createAssistantMessageEventStream, streamSimple } = await import('@earendil-works/pi-ai');

    // First streamSimple call: fire onResponse(429) then push an error event.
    vi.mocked(streamSimple).mockImplementationOnce((_model, _ctx, opts) => {
      const stream = createAssistantMessageEventStream();
      void (async () => {
        await opts?.onResponse?.({ status: 429, headers: {} }, _model as never);
        stream.push({ type: 'error', reason: 'error', error: { role: 'assistant', content: [], stopReason: 'error' } } as never);
        stream.end();
      })();
      return stream;
    });
    // Second streamSimple call: normal done stream.
    vi.mocked(streamSimple).mockImplementationOnce((_model, _ctx, _opts) => {
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: 'stop', message: { role: 'assistant', content: [], stopReason: 'stop' } } as never);
      stream.end();
      return stream;
    });

    // Gate: the MockAgent will await this before closing the queue.
    let resolveGate!: () => void;
    const gate = new Promise<void>(resolve => { resolveGate = resolve; });

    scriptNextAgent(
      [{ type: 'agent_start' }, { type: 'agent_end', messages: [] }],
      { waitForPromise: gate },
    );

    const adapter = new PiAgentProviderAdapter();

    const collectPromise = collect(adapter, 'hi', {
      onAgentReady: () => {
        // Synchronous: fires between Agent construction and agent.prompt().
        // Start streamFn so the retry pump runs concurrently with agent.prompt().
        const streamFn = mockAgentInstances[0]?.constructorOpts?.streamFn;
        if (streamFn) {
          void streamFn({ id: 'test-model' } as never, { messages: [] } as never, {} as never);
        }
      },
    });

    // Flush microtasks: adapter runs to for-await, MockAgent fires agent_start and
    // agent_end, then hits `await gate` (waitForPromise) and suspends. Meanwhile
    // streamFn's first call fires onResponse(429) and schedules the 1s timer.
    await vi.advanceTimersByTimeAsync(0);
    // Advance through the 1s backoff (Math.random()=0 → exactly 1000ms).
    await vi.advanceTimersByTimeAsync(1_000);
    // onRetry has now fired, pushing retry_scheduled to the still-open queue.
    // Resolve the gate so the MockAgent resumes and queue.close() is called.
    resolveGate();
    // Flush remaining microtasks (second streamFn call, queue drain).
    await vi.advanceTimersByTimeAsync(0);

    const out = await collectPromise;

    const retryMessages = out.filter(m => m.type === 'retry_scheduled');
    expect(retryMessages.length).toBeGreaterThanOrEqual(1);
    expect(retryMessages[0]).toMatchObject({
      type: 'retry_scheduled',
      retryInfo: expect.objectContaining({ attempt: 2, maxAttempts: 5, status: 429 }),
    });
  }, 10_000);
});

describe('vision gating', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv };
    mockAgentInstances.length = 0;
    scriptQueue.length = 0;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('passes images to agent.prompt when the model supports vision', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    await collect(adapter, 'what is this', {
      images: [{ name: 'a.png', mimeType: 'image/png', data: 'QQ==' }],
    });

    const call = mockAgentInstances[0].promptCalls[0];
    expect(call.images).toEqual([{ type: 'image', data: 'QQ==', mimeType: 'image/png' }]);
    expect(call.input).not.toContain('does not support vision');
  });

  it('degrades images to text notices for non-vision models', async () => {
    // Override getModel to return a text-only entry for this run
    const piAi = await import('@earendil-works/pi-ai');
    vi.mocked(piAi.getModel).mockImplementationOnce((provider: string, model: string) => {
      if (provider === 'unknown') throw new Error(`unknown provider: ${provider}`);
      return { provider, id: model, contextWindow: 200000, maxTokens: 8000, input: ['text'] } as never;
    });

    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    await collect(adapter, 'what is this', {
      images: [{ name: 'a.png', mimeType: 'image/png', data: 'QQ==' }],
    });

    const call = mockAgentInstances[0].promptCalls[0];
    expect(call.images).toBeUndefined();
    expect(call.input).toContain('[Image attached: a.png — current model does not support vision]');
  });

  it('plain runs without images behave exactly as before', async () => {
    scriptNextAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
    ]);

    const adapter = new PiAgentProviderAdapter();
    await collect(adapter, 'hello', {});

    const call = mockAgentInstances[0].promptCalls[0];
    expect(call.images).toBeUndefined();
  });
});
