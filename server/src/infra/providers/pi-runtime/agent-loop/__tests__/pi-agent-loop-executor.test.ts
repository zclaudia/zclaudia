import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage, StreamFn } from '@earendil-works/pi-agent-core';

const testState = vi.hoisted(() => ({
  runAgentLoop: vi.fn(),
  lastSignal: undefined as AbortSignal | undefined,
  withStreamRetry: vi.fn((streamFn: StreamFn) => streamFn),
}));

vi.mock('@earendil-works/pi-agent-core', () => ({
  convertToLlm: vi.fn((messages: AgentMessage[]) => messages),
  runAgentLoop: testState.runAgentLoop,
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
    testState.runAgentLoop.mockReset();
    testState.lastSignal = undefined;
    testState.withStreamRetry.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts and throws AgentLoopTimeoutError when the loop times out', async () => {
    testState.runAgentLoop.mockImplementation((_prompts, _context, _config, _emit, signal) => {
      testState.lastSignal = signal;
      return new Promise(() => {});
    });

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
    expect(testState.lastSignal?.aborted).toBe(true);
  });

  it('stops at the maxTurns cap when shouldStopAfterTurn reaches the limit', async () => {
    const hookStop = vi.fn().mockResolvedValue(false);
    let stopResults: boolean[] = [];
    testState.runAgentLoop.mockImplementation(async (_prompts, _context, config, emit) => {
      const shouldStopAfterTurn = config.shouldStopAfterTurn as (
        context: unknown
      ) => Promise<boolean>;
      stopResults = [
        await shouldStopAfterTurn({ turn: 1 }),
        await shouldStopAfterTurn({ turn: 2 }),
      ];
      const messages = [{ role: 'assistant', content: 'done' } as never];
      await emit({ type: 'agent_end', messages });
      return messages;
    });

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

    testState.runAgentLoop.mockImplementation(
      async (_prompts, _context, _config, emit, _signal, streamFn) => {
        streamFn({ id: 'model' } as never, { messages: [] } as never, { temperature: 0 } as never);
        const messages = [{ role: 'assistant', content: 'done' } as never];
        await emit({ type: 'agent_end', messages });
        return messages;
      }
    );

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
      expect.objectContaining({ temperature: 0, cacheRetention: 'long' })
    );
  });

  it('normalizes tool schemas at the stream boundary for moonshot models', async () => {
    let capturedStreamFn: StreamFn | undefined;
    testState.runAgentLoop.mockImplementation(
      async (_prompts, _context, _config, emit, _signal, streamFn) => {
        capturedStreamFn = streamFn as StreamFn;
        emit({ type: 'agent_end', messages: [] } as never);
        return [];
      }
    );

    const baseStreamFn = vi.fn().mockReturnValue('ok');
    await runPiAgentLoop({
      systemPrompt: 'system',
      userInput: 'hello',
      history: [],
      modelInfo: { model: { id: 'kimi-k3' } } as never,
      tools: [],
      hooks: {},
      timeoutMs: 1000,
      sessionId: 'session-1',
      streamFn: baseStreamFn as never,
    });

    const moonshotModel = { id: 'kimi-k3', provider: 'moonshotai', baseUrl: 'https://x' };
    const context = {
      tools: [
        {
          name: 'Read',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            anyOf: [{ required: ['path'] }, { required: ['file_path'] }],
          },
        },
      ],
    };
    (capturedStreamFn as never as (m: unknown, c: unknown, o?: unknown) => unknown)(
      moonshotModel,
      context,
      undefined
    );

    expect(baseStreamFn).toHaveBeenCalledTimes(1);
    const forwardedContext = baseStreamFn.mock.calls[0][1] as {
      tools: Array<{ parameters: Record<string, unknown> }>;
    };
    expect(forwardedContext.tools[0].parameters.anyOf).toBeUndefined();
    expect(forwardedContext.tools[0].parameters.type).toBe('object');
  });
});
