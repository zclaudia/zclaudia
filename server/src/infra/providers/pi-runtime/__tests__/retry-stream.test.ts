import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
} from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import {
  withStreamRetry,
  computeDelay,
  isRetryable,
  MAX_REASONABLE_RETRY_AFTER_MS,
  DEFAULT_RETRY_POLICY,
  UNBOUNDED_RETRY_MAX_ATTEMPTS,
  ModelRetryBudget,
  isUnboundedRetryBudget,
  isSingleAttemptRetryBudget,
  resolveRetryOptionsForBudget,
  retryBudgetAllows,
  retryAttemptLoopContinues,
  retryBudgetMaxAttempts,
  resolveRetryPolicy,
} from '../retry-stream.js';
import {
  classifyErrorText,
  extractBusinessCode,
  lookupBusinessCode,
} from '../provider-business-codes.js';

const am = (over: Partial<AssistantMessage> = {}): AssistantMessage =>
  ({ role: 'assistant', content: [], stopReason: 'stop', ...over }) as unknown as AssistantMessage;

const START: AssistantMessageEvent = { type: 'start', partial: am() } as never;
const TEXT: AssistantMessageEvent = { type: 'text_start', contentIndex: 0, partial: am() } as never;
const DONE: AssistantMessageEvent = { type: 'done', reason: 'stop', message: am() } as never;
const ERR = (reason: 'error' | 'aborted' = 'error'): AssistantMessageEvent =>
  ({ type: 'error', reason, error: am({ stopReason: reason }) }) as never;
const BIZ_ERR = (errorMessage: string): AssistantMessageEvent =>
  ({
    type: 'error',
    reason: 'error',
    error: am({ stopReason: 'error', errorMessage }),
  }) as never;

interface AttemptScript {
  response?: { status: number; headers?: Record<string, string> };
  events: AssistantMessageEvent[];
}

function scriptedStream(scripts: AttemptScript[]): { fn: StreamFn; calls: number[] } {
  const calls: number[] = [];
  let i = 0;
  const fn: StreamFn = (_m, _c, opts) => {
    const script = scripts[Math.min(i, scripts.length - 1)];
    calls.push(i);
    i += 1;
    const stream = createAssistantMessageEventStream();
    void (async () => {
      if (script.response)
        await opts?.onResponse?.(
          { status: script.response.status, headers: script.response.headers ?? {} },
          _m as never
        );
      for (const ev of script.events) stream.push(ev);
      stream.end();
    })();
    return stream;
  };
  return { fn, calls };
}

async function collect(
  stream: AsyncIterable<AssistantMessageEvent>
): Promise<AssistantMessageEvent[]> {
  const out: AssistantMessageEvent[] = [];
  for await (const ev of stream) out.push(ev);
  return out;
}

describe('withStreamRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries a pre-content 429 and succeeds on the second attempt without duplicate start', async () => {
    const onRetry = vi.fn();
    const { fn, calls } = scriptedStream([
      { response: { status: 429 }, events: [START, ERR()] },
      { response: { status: 200 }, events: [START, TEXT, DONE] },
    ]);

    const wrapped = withStreamRetry(fn, { onRetry });
    const resultStream = wrapped({} as never, { messages: [] }, undefined);

    // Flush microtasks so the first attempt fires and the delay starts
    await vi.advanceTimersByTimeAsync(0);
    // Advance through the 1000ms backoff
    await vi.advanceTimersByTimeAsync(1000);

    const events = await collect(resultStream);

    expect(events.map(e => e.type)).toEqual(['start', 'text_start', 'done']);
    expect(calls.length).toBe(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 2,
      maxAttempts: DEFAULT_RETRY_POLICY.maxAttempts,
      delayMs: 1000,
      status: 429,
    });
  });

  it('does not retry once content has been forwarded', async () => {
    const onRetry = vi.fn();
    const { fn, calls } = scriptedStream([
      { response: { status: 200 }, events: [START, TEXT, ERR()] },
    ]);

    const wrapped = withStreamRetry(fn, { onRetry });
    const resultStream = wrapped({} as never, { messages: [] }, undefined);

    await vi.advanceTimersByTimeAsync(0);

    const events = await collect(resultStream);

    expect(events.map(e => e.type)).toEqual(['start', 'text_start', 'error']);
    expect(calls.length).toBe(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('never retries aborted errors', async () => {
    const onRetry = vi.fn();
    const { fn, calls } = scriptedStream([
      { response: { status: 200 }, events: [START, ERR('aborted')] },
    ]);

    const wrapped = withStreamRetry(fn, { onRetry });
    const resultStream = wrapped({} as never, { messages: [] }, undefined);

    await vi.advanceTimersByTimeAsync(0);

    const events = await collect(resultStream);

    expect(events.length).toBe(1);
    expect(events[0].type).toBe('error');
    expect((events[0] as Extract<AssistantMessageEvent, { type: 'error' }>).reason).toBe('aborted');
    expect(calls.length).toBe(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('gives up after the default attempt cap with onRetry fired cap-1 times', async () => {
    const onRetry = vi.fn();
    const { fn, calls } = scriptedStream([{ response: { status: 529 }, events: [START, ERR()] }]);

    const wrapped = withStreamRetry(fn, { onRetry });
    const resultStream = wrapped({} as never, { messages: [] }, undefined);

    // Advance enough time for all retries
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < DEFAULT_RETRY_POLICY.maxAttempts; i++) {
      await vi.advanceTimersByTimeAsync(DEFAULT_RETRY_POLICY.maxDelayMs);
    }

    const events = await collect(resultStream);

    expect(events.map(e => e.type)).toEqual(['error']);
    expect(calls.length).toBe(DEFAULT_RETRY_POLICY.maxAttempts);
    expect(onRetry).toHaveBeenCalledTimes(DEFAULT_RETRY_POLICY.maxAttempts - 1);
  });

  it('honors retry-after over the exponential schedule', async () => {
    const onRetry = vi.fn();
    const { fn } = scriptedStream([
      { response: { status: 429, headers: { 'retry-after': '30' } }, events: [START, ERR()] },
      { response: { status: 200 }, events: [START, TEXT, DONE] },
    ]);

    const wrapped = withStreamRetry(fn, { onRetry });
    const resultStream = wrapped({} as never, { messages: [] }, undefined);

    // Flush microtasks so first attempt fires and delay starts
    await vi.advanceTimersByTimeAsync(0);

    // onRetry should have been called with delayMs 30_000
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 2,
      maxAttempts: DEFAULT_RETRY_POLICY.maxAttempts,
      delayMs: 30_000,
      status: 429,
    });

    // Advance to just before the delay expires — stream not done yet
    await vi.advanceTimersByTimeAsync(29_999);
    // The resultStream promise should not be settled yet; we can't easily check that
    // without a race, so just verify it resolves after the remaining 1ms
    await vi.advanceTimersByTimeAsync(1);

    const events = await collect(resultStream);
    expect(events.map(e => e.type)).toEqual(['start', 'text_start', 'done']);
  });

  it('adopts a 120s retry-after verbatim instead of capping it at 60s', async () => {
    const onRetry = vi.fn();
    const { fn } = scriptedStream([
      { response: { status: 429, headers: { 'retry-after': '120' } }, events: [START, ERR()] },
      { response: { status: 200 }, events: [START, TEXT, DONE] },
    ]);

    const wrapped = withStreamRetry(fn, { onRetry });
    const resultStream = wrapped({} as never, { messages: [] }, undefined);

    await vi.advanceTimersByTimeAsync(0);

    expect(onRetry).toHaveBeenCalledWith({
      attempt: 2,
      maxAttempts: DEFAULT_RETRY_POLICY.maxAttempts,
      delayMs: 120_000,
      status: 429,
    });

    await vi.advanceTimersByTimeAsync(120_000);

    const events = await collect(resultStream);
    expect(events.map(e => e.type)).toEqual(['start', 'text_start', 'done']);
  });

  it('prefers the retry-after-ms header over retry-after', async () => {
    const onRetry = vi.fn();
    const { fn } = scriptedStream([
      {
        response: {
          status: 429,
          headers: { 'retry-after': '30', 'retry-after-ms': '250' },
        },
        events: [START, ERR()],
      },
      { response: { status: 200 }, events: [START, TEXT, DONE] },
    ]);

    const wrapped = withStreamRetry(fn, { onRetry });
    const resultStream = wrapped({} as never, { messages: [] }, undefined);

    await vi.advanceTimersByTimeAsync(0);

    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ delayMs: 250 }));

    await vi.advanceTimersByTimeAsync(250);

    const events = await collect(resultStream);
    expect(events.map(e => e.type)).toEqual(['start', 'text_start', 'done']);
  });

  it('retries a retryable business code delivered on status 200', async () => {
    const onRetry = vi.fn();
    const { fn, calls } = scriptedStream([
      {
        response: { status: 200 },
        events: [START, BIZ_ERR('[1302][aa][req-1] concurrency too high')],
      },
      { response: { status: 200 }, events: [START, TEXT, DONE] },
    ]);

    const wrapped = withStreamRetry(fn, { onRetry });
    const resultStream = wrapped({} as never, { messages: [] }, undefined);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);

    const events = await collect(resultStream);

    expect(events.map(e => e.type)).toEqual(['start', 'text_start', 'done']);
    expect(calls.length).toBe(2);
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 2,
      maxAttempts: DEFAULT_RETRY_POLICY.maxAttempts,
      delayMs: 1000,
      status: 200,
      businessCode: '1302',
    });
  });

  it('does not retry a terminal business code even on a retryable 5xx', async () => {
    const onRetry = vi.fn();
    const { fn, calls } = scriptedStream([
      {
        response: { status: 503 },
        events: [START, BIZ_ERR('[1304][aa][req-1] daily limit reached')],
      },
    ]);

    const wrapped = withStreamRetry(fn, { onRetry });
    const resultStream = wrapped({} as never, { messages: [] }, undefined);

    await vi.advanceTimersByTimeAsync(0);

    const events = await collect(resultStream);

    expect(events.map(e => e.type)).toEqual(['error']);
    expect(calls.length).toBe(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('does not retry when the x-should-retry header vetoes it', async () => {
    const onRetry = vi.fn();
    const { fn, calls } = scriptedStream([
      {
        response: { status: 503, headers: { 'x-should-retry': 'false' } },
        events: [START, ERR()],
      },
    ]);

    const wrapped = withStreamRetry(fn, { onRetry });
    const resultStream = wrapped({} as never, { messages: [] }, undefined);

    await vi.advanceTimersByTimeAsync(0);

    const events = await collect(resultStream);

    expect(events.map(e => e.type)).toEqual(['error']);
    expect(calls.length).toBe(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('does not retry non-retryable statuses (401)', async () => {
    const onRetry = vi.fn();
    const { fn, calls } = scriptedStream([{ response: { status: 401 }, events: [START, ERR()] }]);

    const wrapped = withStreamRetry(fn, { onRetry });
    const resultStream = wrapped({} as never, { messages: [] }, undefined);

    await vi.advanceTimersByTimeAsync(0);

    const events = await collect(resultStream);

    expect(events.map(e => e.type)).toEqual(['error']);
    expect(calls.length).toBe(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('treats missing onResponse (connection failure) as retryable with status undefined', async () => {
    const onRetry = vi.fn();
    const { fn } = scriptedStream([
      { events: [ERR()] }, // no response callback fired
      { response: { status: 200 }, events: [START, TEXT, DONE] },
    ]);

    const wrapped = withStreamRetry(fn, { onRetry });
    const resultStream = wrapped({} as never, { messages: [] }, undefined);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);

    const events = await collect(resultStream);

    expect(events.map(e => e.type)).toEqual(['start', 'text_start', 'done']);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }));
  });

  it('abort during backoff emits a synthetic aborted error immediately', async () => {
    const ac = new AbortController();
    const { fn } = scriptedStream([{ response: { status: 429 }, events: [START, ERR()] }]);

    const wrapped = withStreamRetry(fn, {});
    const resultStream = wrapped({} as never, { messages: [] }, { signal: ac.signal });

    // Flush microtasks — first attempt fires, delay begins
    await vi.advanceTimersByTimeAsync(0);
    // Advance slightly but not enough to finish the delay
    await vi.advanceTimersByTimeAsync(10);
    // Abort during backoff
    ac.abort();
    await vi.advanceTimersByTimeAsync(0);

    const events = await collect(resultStream);

    expect(events.length).toBe(1);
    expect(events[0].type).toBe('error');
    expect((events[0] as Extract<AssistantMessageEvent, { type: 'error' }>).reason).toBe('aborted');
  });

  it('chains the caller-provided onResponse', async () => {
    const callerOnResponse = vi.fn();
    const { fn } = scriptedStream([{ response: { status: 200 }, events: [START, TEXT, DONE] }]);

    const wrapped = withStreamRetry(fn, {});
    const resultStream = wrapped({} as never, { messages: [] }, { onResponse: callerOnResponse });

    await vi.advanceTimersByTimeAsync(0);

    await collect(resultStream);

    expect(callerOnResponse).toHaveBeenCalledTimes(1);
    expect(callerOnResponse).toHaveBeenCalledWith(
      expect.objectContaining({ status: 200 }),
      expect.anything()
    );
  });

  it('surfaces a synthetic error instead of crashing when caller onResponse throws', async () => {
    const { fn } = scriptedStream([{ response: { status: 200 }, events: [START, TEXT, DONE] }]);
    const events = await collect(
      await withStreamRetry(fn)({} as never, {} as never, {
        onResponse: () => {
          throw new Error('caller boom');
        },
      })
    );
    expect(events.map(e => e.type)).toEqual(['error']);
    expect((events[0] as { error: { errorMessage?: string } }).error.errorMessage).toContain(
      'caller boom'
    );
  });
});

describe('withStreamRetry budget tiers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('single-attempt budget surfaces the first transient failure immediately', async () => {
    const onRetry = vi.fn();
    const { fn, calls } = scriptedStream([
      { response: { status: 429 }, events: [START, ERR()] },
      { response: { status: 200 }, events: [START, TEXT, DONE] },
    ]);

    const wrapped = withStreamRetry(fn, { onRetry, budget: ModelRetryBudget.SingleAttempt });
    const resultStream = wrapped({} as never, { messages: [] }, undefined);

    await vi.advanceTimersByTimeAsync(0);

    const events = await collect(resultStream);

    expect(events.map(e => e.type)).toEqual(['error']);
    expect(calls.length).toBe(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('unbounded budget keeps retrying past the default attempt cap and reports the 0 sentinel', async () => {
    const onRetry = vi.fn();
    const failure: AttemptScript = { response: { status: 429 }, events: [START, ERR()] };
    const { fn, calls } = scriptedStream([
      ...Array.from({ length: 7 }, () => failure),
      { response: { status: 200 }, events: [START, TEXT, DONE] },
    ]);

    const wrapped = withStreamRetry(fn, { onRetry, budget: ModelRetryBudget.Unbounded });
    const resultStream = wrapped({} as never, { messages: [] }, undefined);

    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 9; i++) {
      await vi.advanceTimersByTimeAsync(DEFAULT_RETRY_POLICY.maxDelayMs);
    }

    const events = await collect(resultStream);

    expect(events.map(e => e.type)).toEqual(['start', 'text_start', 'done']);
    expect(calls.length).toBe(8); // default cap is 5 — unbounded blew past it
    expect(onRetry).toHaveBeenCalledTimes(7);
    expect(onRetry).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxAttempts: UNBOUNDED_RETRY_MAX_ATTEMPTS })
    );
  });

  it('unbounded budget still gives up on non-retryable failures', async () => {
    const onRetry = vi.fn();
    const { fn, calls } = scriptedStream([{ response: { status: 401 }, events: [START, ERR()] }]);

    const wrapped = withStreamRetry(fn, { onRetry, budget: ModelRetryBudget.Unbounded });
    const resultStream = wrapped({} as never, { messages: [] }, undefined);

    await vi.advanceTimersByTimeAsync(0);

    const events = await collect(resultStream);

    expect(events.map(e => e.type)).toEqual(['error']);
    expect(calls.length).toBe(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('unbounded budget still never retries after content has been forwarded', async () => {
    const onRetry = vi.fn();
    const { fn, calls } = scriptedStream([
      { response: { status: 200 }, events: [START, TEXT, ERR()] },
    ]);

    const wrapped = withStreamRetry(fn, { onRetry, budget: ModelRetryBudget.Unbounded });
    const resultStream = wrapped({} as never, { messages: [] }, undefined);

    await vi.advanceTimersByTimeAsync(0);

    const events = await collect(resultStream);

    expect(events.map(e => e.type)).toEqual(['start', 'text_start', 'error']);
    expect(calls.length).toBe(1);
    expect(onRetry).not.toHaveBeenCalled();
  });
});

describe('withStreamRetry env-tunable policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('env override shrinks the attempt budget', async () => {
    const onRetry = vi.fn();
    const { fn, calls } = scriptedStream([
      { response: { status: 429 }, events: [START, ERR()] },
      { response: { status: 429 }, events: [START, ERR()] },
      { response: { status: 200 }, events: [START, TEXT, DONE] },
    ]);

    const wrapped = withStreamRetry(fn, {
      onRetry,
      env: { ZCLAUDIA_MODEL_RETRY_MAX_ATTEMPTS: '2' },
    });
    const resultStream = wrapped({} as never, { messages: [] }, undefined);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(DEFAULT_RETRY_POLICY.maxDelayMs);

    const events = await collect(resultStream);

    expect(events.map(e => e.type)).toEqual(['error']);
    expect(calls.length).toBe(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ maxAttempts: 2 }));
  });

  it('explicit retry options beat the env record', async () => {
    const onRetry = vi.fn();
    const { fn, calls } = scriptedStream([
      { response: { status: 429 }, events: [START, ERR()] },
      { response: { status: 200 }, events: [START, TEXT, DONE] },
    ]);

    const wrapped = withStreamRetry(fn, {
      onRetry,
      env: { ZCLAUDIA_MODEL_RETRY_MAX_ATTEMPTS: '9' },
      retry: { maxAttempts: 2 },
    });
    const resultStream = wrapped({} as never, { messages: [] }, undefined);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(DEFAULT_RETRY_POLICY.maxDelayMs);

    const events = await collect(resultStream);

    expect(events.map(e => e.type)).toEqual(['start', 'text_start', 'done']);
    expect(calls.length).toBe(2);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ maxAttempts: 2 }));
  });

  it('env override rescales the backoff base', async () => {
    const onRetry = vi.fn();
    const { fn } = scriptedStream([
      { response: { status: 429 }, events: [START, ERR()] },
      { response: { status: 200 }, events: [START, TEXT, DONE] },
    ]);

    const wrapped = withStreamRetry(fn, {
      onRetry,
      env: { ZCLAUDIA_MODEL_RETRY_BASE_DELAY_MS: '5000' },
    });
    wrapped({} as never, { messages: [] }, undefined);

    await vi.advanceTimersByTimeAsync(0);

    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ delayMs: 5000 }));
  });
});

describe('retry budget helpers', () => {
  it('classifies tiers', () => {
    expect(isUnboundedRetryBudget(ModelRetryBudget.Unbounded)).toBe(true);
    expect(isUnboundedRetryBudget(undefined)).toBe(false);
    expect(isUnboundedRetryBudget(ModelRetryBudget.Default)).toBe(false);
    expect(isSingleAttemptRetryBudget(ModelRetryBudget.SingleAttempt)).toBe(true);
    expect(isSingleAttemptRetryBudget(undefined)).toBe(false);
  });

  it('gates: unbounded always allows, default compares against maxAttempts', () => {
    expect(retryBudgetAllows(ModelRetryBudget.Unbounded, 999, 5)).toBe(true);
    expect(retryBudgetAllows(ModelRetryBudget.Default, 4, 5)).toBe(true);
    expect(retryBudgetAllows(ModelRetryBudget.Default, 5, 5)).toBe(false);
    expect(retryBudgetAllows(undefined, 5, 5)).toBe(false);
    expect(retryAttemptLoopContinues(ModelRetryBudget.Unbounded, 999, 5)).toBe(true);
    expect(retryAttemptLoopContinues(ModelRetryBudget.Default, 5, 5)).toBe(true);
    expect(retryAttemptLoopContinues(ModelRetryBudget.Default, 6, 5)).toBe(false);
  });

  it('reports the 0 sentinel maxAttempts under unbounded', () => {
    expect(retryBudgetMaxAttempts(ModelRetryBudget.Unbounded, 5)).toBe(
      UNBOUNDED_RETRY_MAX_ATTEMPTS
    );
    expect(retryBudgetMaxAttempts(undefined, 5)).toBe(5);
    expect(retryBudgetMaxAttempts(ModelRetryBudget.SingleAttempt, 5)).toBe(5);
  });
});

describe('resolveRetryPolicy', () => {
  it('defaults reproduce the historical hardcodes', () => {
    expect(resolveRetryPolicy(undefined, {})).toEqual({
      maxAttempts: 5,
      baseDelayMs: 1_000,
      backoffFactor: 2,
      maxDelayMs: 60_000,
      jitterMs: 250,
    });
    expect(resolveRetryPolicy(undefined, {})).toEqual(DEFAULT_RETRY_POLICY);
  });

  it('reads ZCLAUDIA_MODEL_RETRY_* overrides from the explicit env record', () => {
    expect(
      resolveRetryPolicy(undefined, {
        ZCLAUDIA_MODEL_RETRY_MAX_ATTEMPTS: '9',
        ZCLAUDIA_MODEL_RETRY_BASE_DELAY_MS: '3000',
        ZCLAUDIA_MODEL_RETRY_BACKOFF_FACTOR: '3',
        ZCLAUDIA_MODEL_RETRY_MAX_DELAY_MS: '120000',
        ZCLAUDIA_MODEL_RETRY_JITTER_MS: '0',
      })
    ).toEqual({
      maxAttempts: 9,
      baseDelayMs: 3_000,
      backoffFactor: 3,
      maxDelayMs: 120_000,
      jitterMs: 0,
    });
  });

  it('ignores blank and invalid env values and keeps the defaults', () => {
    expect(
      resolveRetryPolicy(undefined, {
        ZCLAUDIA_MODEL_RETRY_MAX_ATTEMPTS: 'not-a-number',
        ZCLAUDIA_MODEL_RETRY_BASE_DELAY_MS: '  ',
        ZCLAUDIA_MODEL_RETRY_BACKOFF_FACTOR: '-2',
        ZCLAUDIA_MODEL_RETRY_MAX_DELAY_MS: '-1',
        ZCLAUDIA_MODEL_RETRY_JITTER_MS: 'abc',
      })
    ).toEqual(DEFAULT_RETRY_POLICY);
  });

  it('normalizes env numbers (floors, minimum one attempt)', () => {
    expect(
      resolveRetryPolicy(undefined, { ZCLAUDIA_MODEL_RETRY_MAX_ATTEMPTS: '2.9' }).maxAttempts
    ).toBe(2);
    expect(
      resolveRetryPolicy(undefined, { ZCLAUDIA_MODEL_RETRY_MAX_ATTEMPTS: '0' }).maxAttempts
    ).toBe(1);
    expect(resolveRetryPolicy(undefined, { ZCLAUDIA_MODEL_RETRY_JITTER_MS: '99.9' }).jitterMs).toBe(
      99
    );
  });

  it('explicit options win over env, env wins over defaults', () => {
    const env = {
      ZCLAUDIA_MODEL_RETRY_MAX_ATTEMPTS: '9',
      ZCLAUDIA_MODEL_RETRY_BASE_DELAY_MS: '4000',
    };
    expect(resolveRetryPolicy({ maxAttempts: 2 }, env)).toEqual({
      ...DEFAULT_RETRY_POLICY,
      maxAttempts: 2,
      baseDelayMs: 4_000,
    });
    expect(resolveRetryPolicy(undefined, env).baseDelayMs).toBe(4_000);
  });

  it('single-attempt budget collapses maxAttempts without touching the curve', () => {
    const resolved = resolveRetryOptionsForBudget(
      DEFAULT_RETRY_POLICY,
      ModelRetryBudget.SingleAttempt
    );
    expect(resolved.maxAttempts).toBe(1);
    expect(resolved.baseDelayMs).toBe(DEFAULT_RETRY_POLICY.baseDelayMs);
    expect(resolved.jitterMs).toBe(DEFAULT_RETRY_POLICY.jitterMs);
    // Default/undefined budgets return the policy untouched.
    expect(resolveRetryOptionsForBudget(DEFAULT_RETRY_POLICY, undefined)).toBe(
      DEFAULT_RETRY_POLICY
    );
    expect(resolveRetryOptionsForBudget(DEFAULT_RETRY_POLICY, ModelRetryBudget.Default)).toBe(
      DEFAULT_RETRY_POLICY
    );
  });
});

describe('computeDelay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('doubles per attempt and caps at MAX_DELAY_MS', () => {
    expect(computeDelay(1)).toBe(1000);
    expect(computeDelay(2)).toBe(2000);
    expect(computeDelay(4)).toBe(8000);
    // attempt 20 should be capped
    expect(computeDelay(20)).toBe(DEFAULT_RETRY_POLICY.maxDelayMs);
  });

  it('adopts a reasonable retry-after header verbatim (up to 5 minutes)', () => {
    // 120s used to be capped at MAX_DELAY_MS; reasonable waits are now kept whole.
    expect(computeDelay(1, '120')).toBe(120_000);
    expect(computeDelay(1, '30')).toBe(30_000);
  });

  it('falls back to capped exponential backoff when retry-after exceeds 5 minutes', () => {
    expect(computeDelay(1, '3600')).toBe(1000); // 1h is unreasonable → exponential
    expect(computeDelay(1, String(MAX_REASONABLE_RETRY_AFTER_MS / 1000 + 1))).toBe(1000);
    expect(computeDelay(20, '3600')).toBe(DEFAULT_RETRY_POLICY.maxDelayMs); // exponential still capped
  });

  it('parses an HTTP-date retry-after relative to now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T00:00:00Z'));
    expect(computeDelay(1, new Date('2026-06-10T00:00:10Z').toUTCString())).toBe(10_000);
    // A past date is not a reasonable wait — fall back to the exponential schedule.
    expect(computeDelay(1, new Date('2026-06-09T00:00:00Z').toUTCString())).toBe(1000);
    vi.useRealTimers();
  });

  it('prefers retry-after-ms over retry-after and applies the same reasonableness rule', () => {
    expect(computeDelay(1, undefined, '1500')).toBe(1500);
    expect(computeDelay(1, '60', '1500')).toBe(1500); // ms header wins
    expect(computeDelay(1, undefined, '700000')).toBe(1000); // 700s > 5min → exponential
  });
});

describe('isRetryable', () => {
  it('classifies statuses correctly', () => {
    for (const s of [408, 429, 500, 502, 503, 504, 529]) {
      expect(isRetryable(s)).toBe(true);
    }
    for (const s of [400, 401, 403, 404, 422]) {
      expect(isRetryable(s)).toBe(false);
    }
    expect(isRetryable(undefined)).toBe(true);
  });

  it('lets retryable business codes win even on status 200', () => {
    expect(isRetryable(200, { errorMessage: '[1302][aa][req-1] concurrency too high' })).toBe(true);
    expect(isRetryable(200, { errorMessage: '{"error":{"code":"rate_limit_error"}}' })).toBe(true);
  });

  it('lets terminal business codes veto retry even on retryable 5xx', () => {
    expect(isRetryable(503, { errorMessage: '[1304][aa][req-1] daily limit reached' })).toBe(false);
    expect(
      isRetryable(429, {
        errorMessage: '{"error":{"message":"_quota","code":"insufficient_quota"}}',
      })
    ).toBe(false);
  });

  it('falls through to the status verdict for unknown business codes', () => {
    expect(isRetryable(503, { errorMessage: '[9999][aa][req-1] mystery' })).toBe(true);
    expect(isRetryable(200, { errorMessage: '[9999][aa][req-1] mystery' })).toBe(false);
    expect(isRetryable(503, { errorMessage: 'no code here' })).toBe(true);
  });

  it('blocks retry on an explicit x-should-retry false/0 header', () => {
    expect(isRetryable(503, { headers: { 'x-should-retry': 'false' } })).toBe(false);
    expect(isRetryable(429, { headers: { 'X-Should-Retry': '0' } })).toBe(false);
    expect(isRetryable(503, { headers: { 'x-should-retry': 'true' } })).toBe(true);
    // The veto is absolute — it also wins over a retryable business code.
    expect(
      isRetryable(200, {
        errorMessage: '[1302][aa][req-1]',
        headers: { 'x-should-retry': 'false' },
      })
    ).toBe(false);
  });
});

describe('provider-business-codes', () => {
  it('extracts BigModel bracket prefixes and OpenAI-style code fields', () => {
    expect(extractBusinessCode('[1302][aa][req-1] concurrency too high')).toBe('1302');
    expect(extractBusinessCode('  [20097][aa][req-1] quota')).toBe('20097');
    expect(extractBusinessCode('{"error":{"message":"boom","code":"insufficient_quota"}}')).toBe(
      'insufficient_quota'
    );
    expect(extractBusinessCode('upstream says {"error":{"code":1302}} inline')).toBe('1302');
    expect(extractBusinessCode('plain failure, nothing to see')).toBeUndefined();
    expect(extractBusinessCode(undefined)).toBeUndefined();
  });

  it('classifies table codes with ZCode semantics', () => {
    for (const code of ['1120', '1230', '1234', '1302', '1303', '1305', '1312']) {
      expect(lookupBusinessCode(code)?.retryable).toBe(true);
    }
    for (const code of ['1113', '1304', '1308', '1309', '1310', '1311', '1313']) {
      expect(lookupBusinessCode(code)?.retryable).toBe(false);
    }
    for (const code of ['insufficient_quota', 'credit_balance_exhausted', '2056']) {
      expect(lookupBusinessCode(code)?.retryable).toBe(false);
    }
    expect(lookupBusinessCode('INSUFFICIENT_QUOTA')?.retryable).toBe(false);
    expect(lookupBusinessCode('9999')).toBeUndefined();
  });

  it('returns undefined from classifyErrorText for codes outside the table', () => {
    expect(classifyErrorText('[1305][aa][req-1]')).toEqual({
      code: '1305',
      info: { retryable: true, reason: 'rate_limited' },
    });
    expect(classifyErrorText('[9999][aa][req-1]')).toBeUndefined();
  });
});
