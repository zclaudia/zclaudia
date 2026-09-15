import { describe, expect, it } from 'vitest';
import {
  extractClaudeCallContextTokens,
  extractClaudeContextWindow,
  pumpClaudeStream,
  transformClaudeSdkMessage,
} from '../runner.js';

describe('transformClaudeSdkMessage result usage', () => {
  it('forwards the SDK result usage as provider-neutral usage', () => {
    const event = transformClaudeSdkMessage({
      type: 'result',
      subtype: 'success',
      result: 'done',
      total_cost_usd: 0.042,
      usage: {
        input_tokens: 500,
        output_tokens: 80,
        cache_read_input_tokens: 4500,
        cache_creation_input_tokens: 120,
      },
    });

    expect(event).toMatchObject({
      type: 'result',
      isComplete: true,
      usage: {
        input: 500,
        output: 80,
        cacheRead: 4500,
        cacheWrite: 120,
        totalTokens: 5200,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.042 },
      },
    });
  });

  it('omits usage when the result message carries none', () => {
    const event = transformClaudeSdkMessage({
      type: 'result',
      subtype: 'success',
      result: 'done',
    });
    expect(event).toMatchObject({ type: 'result', isComplete: true });
    expect((event as { usage?: unknown }).usage).toBeUndefined();
  });

  it('still maps execution errors without usage', () => {
    const event = transformClaudeSdkMessage({
      type: 'result',
      subtype: 'error_during_execution',
      error: 'boom',
    });
    expect(event).toMatchObject({ type: 'error', error: 'boom' });
  });
});

describe('extractClaudeCallContextTokens', () => {
  const assistant = (usage: Record<string, number>, extra = {}) => ({
    type: 'assistant',
    parent_tool_use_id: null,
    message: { usage },
    ...extra,
  });

  it('sums the three input-side buckets of one API call', () => {
    expect(
      extractClaudeCallContextTokens(
        assistant({
          input_tokens: 500,
          cache_read_input_tokens: 40_000,
          cache_creation_input_tokens: 1_200,
          output_tokens: 80,
        })
      )
    ).toBe(41_700);
  });

  it('ignores sub-agent calls, which occupy their own window', () => {
    expect(
      extractClaudeCallContextTokens(
        assistant({ input_tokens: 900 }, { parent_tool_use_id: 'toolu_1' })
      )
    ).toBeUndefined();
  });

  it('ignores messages without a usage block or with zero occupancy', () => {
    expect(extractClaudeCallContextTokens({ type: 'assistant', message: {} })).toBeUndefined();
    expect(extractClaudeCallContextTokens(assistant({ output_tokens: 10 }))).toBeUndefined();
    expect(extractClaudeCallContextTokens({ type: 'result' })).toBeUndefined();
  });
});

describe('extractClaudeContextWindow', () => {
  it('takes the window of the model that carried the most context', () => {
    expect(
      extractClaudeContextWindow({
        type: 'result',
        modelUsage: {
          'claude-haiku-4-5': {
            inputTokens: 300,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            contextWindow: 200_000,
          },
          'claude-opus-5': {
            inputTokens: 500,
            cacheReadInputTokens: 60_000,
            cacheCreationInputTokens: 0,
            contextWindow: 1_000_000,
          },
        },
      })
    ).toBe(1_000_000);
  });

  it('skips entries without a usable window', () => {
    expect(
      extractClaudeContextWindow({
        type: 'result',
        modelUsage: {
          a: { inputTokens: 9_000, contextWindow: 0 },
          b: { inputTokens: 10, contextWindow: 200_000 },
        },
      })
    ).toBe(200_000);
  });

  it('returns undefined when modelUsage is absent or empty', () => {
    expect(extractClaudeContextWindow({ type: 'result' })).toBeUndefined();
    expect(extractClaudeContextWindow({ type: 'result', modelUsage: {} })).toBeUndefined();
    expect(extractClaudeContextWindow({ type: 'assistant' })).toBeUndefined();
  });
});

describe('pumpClaudeStream context reporting', () => {
  /** Minimal stand-in for the SDK query stream. */
  function fakeStream(messages: unknown[]) {
    return {
      async *[Symbol.asyncIterator]() {
        for (const m of messages) yield m;
      },
      close() {},
    };
  }

  const INIT = {
    type: 'system',
    subtype: 'init',
    session_id: 'sess_1',
    model: 'claude-opus-5',
    cwd: '/repo',
  };

  async function collect(messages: unknown[]) {
    const events = [];
    for await (const event of pumpClaudeStream(fakeStream(messages), {} as never)) {
      events.push(event);
    }
    return events;
  }

  it('attaches the final call occupancy to the result usage', async () => {
    const events = await collect([
      INIT,
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: { usage: { input_tokens: 10, cache_read_input_tokens: 1_000 }, content: [] },
      },
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: { usage: { input_tokens: 20, cache_read_input_tokens: 40_000 }, content: [] },
      },
      {
        type: 'result',
        subtype: 'success',
        result: 'done',
        total_cost_usd: 0.01,
        usage: { input_tokens: 30, output_tokens: 5, cache_read_input_tokens: 41_000 },
        modelUsage: {
          'claude-opus-5': {
            inputTokens: 30,
            cacheReadInputTokens: 41_000,
            contextWindow: 200_000,
          },
        },
      },
    ]);

    const result = events.find(e => e.type === 'result');
    // The LAST call's occupancy, not the turn sum.
    expect(result?.usage).toMatchObject({ contextUsedTokens: 40_020 });
  });

  it('re-announces systemInfo with the runtime-reported window', async () => {
    const events = await collect([
      INIT,
      {
        type: 'result',
        subtype: 'success',
        result: 'done',
        usage: { input_tokens: 30 },
        modelUsage: { 'claude-opus-5': { inputTokens: 30, contextWindow: 200_000 } },
      },
    ]);

    const inits = events.filter(e => e.type === 'init');
    expect(inits).toHaveLength(2);
    expect(inits[1]).toMatchObject({
      systemInfo: {
        model: 'claude-opus-5',
        cwd: '/repo',
        contextWindow: 200_000,
        contextWindowSource: 'runtime',
      },
    });
    // A re-announcement must not look like a new provider session.
    expect(inits[1].sessionId).toBeUndefined();
  });

  it('does not re-announce when the window is unchanged or unknown', async () => {
    const window200k = {
      type: 'result',
      subtype: 'success',
      result: 'done',
      usage: { input_tokens: 1 },
      modelUsage: { m: { inputTokens: 1, contextWindow: 200_000 } },
    };
    const first = await collect([INIT, window200k, window200k]);
    expect(first.filter(e => e.type === 'init')).toHaveLength(2);

    const none = await collect([
      INIT,
      { type: 'result', subtype: 'success', result: 'done', usage: { input_tokens: 1 } },
    ]);
    expect(none.filter(e => e.type === 'init')).toHaveLength(1);
  });
});

describe('probed SDK payload (claude-agent-sdk 0.2.141)', () => {
  // Captured from a real one-turn run. The first turn of a session writes the
  // whole prompt to the cache, so input_tokens is tiny while
  // cache_creation_input_tokens holds the actual occupancy — summing only
  // input + cacheRead (pi's convention) would report 6 tokens instead of
  // 16,656 and leave the ring reading ~0%.
  const ASSISTANT = {
    type: 'assistant',
    parent_tool_use_id: null,
    message: {
      usage: {
        input_tokens: 6,
        cache_creation_input_tokens: 16_650,
        cache_read_input_tokens: 0,
        output_tokens: 1,
      },
    },
  };

  const RESULT = {
    type: 'result',
    subtype: 'success',
    modelUsage: {
      'claude-opus-4-7[1m]': {
        inputTokens: 6,
        outputTokens: 6,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 16_650,
        contextWindow: 1_000_000,
        maxOutputTokens: 64_000,
      },
    },
  };

  it('counts cache creation as occupied window', () => {
    expect(extractClaudeCallContextTokens(ASSISTANT)).toBe(16_656);
  });

  it('reads the window off the beta-suffixed model key', () => {
    expect(extractClaudeContextWindow(RESULT)).toBe(1_000_000);
  });
});
