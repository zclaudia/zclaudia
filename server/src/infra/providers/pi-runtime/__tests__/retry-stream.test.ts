import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAssistantMessageEventStream, type AssistantMessage, type AssistantMessageEvent } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { withStreamRetry, computeDelay, isRetryable, MAX_ATTEMPTS, MAX_DELAY_MS } from '../retry-stream.js';

const am = (over: Partial<AssistantMessage> = {}): AssistantMessage =>
  ({ role: 'assistant', content: [], stopReason: 'stop', ...over }) as unknown as AssistantMessage;

const START: AssistantMessageEvent = { type: 'start', partial: am() } as never;
const TEXT: AssistantMessageEvent = { type: 'text_start', contentIndex: 0, partial: am() } as never;
const DONE: AssistantMessageEvent = { type: 'done', reason: 'stop', message: am() } as never;
const ERR = (reason: 'error' | 'aborted' = 'error'): AssistantMessageEvent =>
  ({ type: 'error', reason, error: am({ stopReason: reason }) }) as never;

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
      if (script.response) await opts?.onResponse?.({ status: script.response.status, headers: script.response.headers ?? {} }, _m as never);
      for (const ev of script.events) stream.push(ev);
      stream.end();
    })();
    return stream;
  };
  return { fn, calls };
}

async function collect(stream: AsyncIterable<AssistantMessageEvent>): Promise<AssistantMessageEvent[]> {
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
    expect(onRetry).toHaveBeenCalledWith({ attempt: 2, maxAttempts: MAX_ATTEMPTS, delayMs: 1000, status: 429 });
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

  it('gives up after MAX_ATTEMPTS with onRetry fired MAX_ATTEMPTS-1 times', async () => {
    const onRetry = vi.fn();
    const { fn, calls } = scriptedStream([
      { response: { status: 529 }, events: [START, ERR()] },
    ]);

    const wrapped = withStreamRetry(fn, { onRetry });
    const resultStream = wrapped({} as never, { messages: [] }, undefined);

    // Advance enough time for all retries
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await vi.advanceTimersByTimeAsync(MAX_DELAY_MS);
    }

    const events = await collect(resultStream);

    expect(events.map(e => e.type)).toEqual(['error']);
    expect(calls.length).toBe(MAX_ATTEMPTS);
    expect(onRetry).toHaveBeenCalledTimes(MAX_ATTEMPTS - 1);
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
    expect(onRetry).toHaveBeenCalledWith({ attempt: 2, maxAttempts: MAX_ATTEMPTS, delayMs: 30_000, status: 429 });

    // Advance to just before the delay expires — stream not done yet
    await vi.advanceTimersByTimeAsync(29_999);
    // The resultStream promise should not be settled yet; we can't easily check that
    // without a race, so just verify it resolves after the remaining 1ms
    await vi.advanceTimersByTimeAsync(1);

    const events = await collect(resultStream);
    expect(events.map(e => e.type)).toEqual(['start', 'text_start', 'done']);
  });

  it('does not retry non-retryable statuses (401)', async () => {
    const onRetry = vi.fn();
    const { fn, calls } = scriptedStream([
      { response: { status: 401 }, events: [START, ERR()] },
    ]);

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
      { events: [ERR()] },  // no response callback fired
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
    const { fn } = scriptedStream([
      { response: { status: 429 }, events: [START, ERR()] },
    ]);

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
    const { fn } = scriptedStream([
      { response: { status: 200 }, events: [START, TEXT, DONE] },
    ]);

    const wrapped = withStreamRetry(fn, {});
    const resultStream = wrapped({} as never, { messages: [] }, { onResponse: callerOnResponse });

    await vi.advanceTimersByTimeAsync(0);

    await collect(resultStream);

    expect(callerOnResponse).toHaveBeenCalledTimes(1);
    expect(callerOnResponse).toHaveBeenCalledWith(
      expect.objectContaining({ status: 200 }),
      expect.anything(),
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
    expect(computeDelay(20)).toBe(MAX_DELAY_MS);
  });

  it('caps retry-after header value at MAX_DELAY_MS', () => {
    expect(computeDelay(1, '120')).toBe(MAX_DELAY_MS);
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
});
