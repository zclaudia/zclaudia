import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage, StreamFn } from '@earendil-works/pi-agent-core';

const testState = vi.hoisted(() => ({
  agentInstances: [] as Array<{
    options: Record<string, unknown>;
    abort: ReturnType<typeof vi.fn>;
    emitEnd: (messages: AgentMessage[]) => void;
  }>,
  promptImpl: undefined as undefined | ((agent: {
    options: Record<string, unknown>;
    abort: ReturnType<typeof vi.fn>;
    emitEnd: (messages: AgentMessage[]) => void;
  }, input: string) => Promise<void>),
  withStreamRetry: vi.fn((streamFn: StreamFn) => streamFn),
}));

vi.mock('@earendil-works/pi-agent-core', () => ({
  Agent: class FakeAgent {
    private subscriber: ((event: { type: string; messages: AgentMessage[] }) => void) | undefined;
    readonly abort = vi.fn();
    readonly options: Record<string, unknown>;

    constructor(options: Record<string, unknown>) {
      this.options = options;
      testState.agentInstances.push(this);
    }

    subscribe(callback: (event: { type: string; messages: AgentMessage[] }) => void) {
      this.subscriber = callback;
      return () => {
        this.subscriber = undefined;
      };
    }

    async prompt(input: string) {
      await testState.promptImpl?.(this, input);
    }

    emitEnd(messages: AgentMessage[]) {
      this.subscriber?.({ type: 'agent_end', messages });
    }
  },
}));

vi.mock('../../retry-stream.js', () => ({
  withStreamRetry: testState.withStreamRetry,
}));

vi.mock('@earendil-works/pi-ai', () => ({
  streamSimple: vi.fn(),
}));

import { AgentLoopTimeoutError, runPiAgentLoop } from '../pi-agent-loop-executor.js';

describe('runPiAgentLoop', () => {
  beforeEach(() => {
    testState.agentInstances.length = 0;
    testState.promptImpl = undefined;
    testState.withStreamRetry.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts and throws AgentLoopTimeoutError when the loop times out', async () => {
    testState.promptImpl = () => new Promise(() => {});

    const runPromise = runPiAgentLoop({
      systemPrompt: 'system',
      userInput: 'hello',
      history: [],
      modelInfo: { model: { id: 'test-model' } } as never,
      tools: [],
      hooks: {},
      timeoutMs: 50,
      maxTurns: 2,
      sessionId: 'session-1',
      streamFn: vi.fn(),
    });

    const rejection = expect(runPromise).rejects.toBeInstanceOf(AgentLoopTimeoutError);
    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    expect(testState.agentInstances[0]?.abort).toHaveBeenCalled();
  });

  it('stops at the maxTurns cap when shouldStopAfterTurn reaches the limit', async () => {
    const hookStop = vi.fn().mockResolvedValue(false);
    let stopResults: boolean[] = [];
    testState.promptImpl = async (agent) => {
      const shouldStopAfterTurn = agent.options.shouldStopAfterTurn as (context: unknown) => Promise<boolean>;
      stopResults = [
        await shouldStopAfterTurn({ turn: 1 }),
        await shouldStopAfterTurn({ turn: 2 }),
      ];
      agent.emitEnd([{ role: 'assistant', content: 'done' } as never]);
    };

    const result = await runPiAgentLoop({
      systemPrompt: 'system',
      userInput: 'hello',
      history: [],
      modelInfo: { model: { id: 'test-model' } } as never,
      tools: [],
      hooks: { shouldStopAfterTurn: hookStop },
      timeoutMs: 1_000,
      maxTurns: 2,
      sessionId: 'session-1',
      streamFn: vi.fn(),
    });

    expect(result.text).toBe('done');
    expect(stopResults).toEqual([false, true]);
    expect(hookStop).toHaveBeenCalledTimes(2);
  });

  it('passes cacheRetention into the wrapped stream function', async () => {
    const baseStreamFn = vi.fn(() => ({ [Symbol.asyncIterator]: async function* () {} }) as never);

    testState.promptImpl = async (agent) => {
      const streamFn = agent.options.streamFn as StreamFn;
      streamFn({ id: 'model' } as never, { messages: [] } as never, { temperature: 0 } as never);
      agent.emitEnd([{ role: 'assistant', content: 'done' } as never]);
    };

    await runPiAgentLoop({
      systemPrompt: 'system',
      userInput: 'hello',
      history: [],
      modelInfo: { model: { id: 'test-model' } } as never,
      tools: [],
      hooks: {},
      timeoutMs: 1_000,
      maxTurns: 2,
      sessionId: 'session-1',
      streamFn: baseStreamFn,
      cacheRetention: 'long',
    });

    expect(testState.withStreamRetry).toHaveBeenCalledOnce();
    expect(baseStreamFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ temperature: 0, cacheRetention: 'long' }),
    );
  });
});
