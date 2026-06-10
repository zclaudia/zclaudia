import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';

export const MAX_ATTEMPTS = 5;
export const BASE_DELAY_MS = 1_000;
export const MAX_DELAY_MS = 60_000;
export const JITTER_MS = 250;

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);

export interface RetryNotification {
  /** Upcoming attempt number (2..MAX_ATTEMPTS). */
  attempt: number;
  maxAttempts: number;
  /** Milliseconds to wait before the next attempt. Zero is possible when a
   * retry-after HTTP-date is in the past. */
  delayMs: number;
  /** HTTP status that triggered the retry; undefined for connection-level failures. */
  status?: number;
}

export interface WithStreamRetryOptions {
  onRetry?: (info: RetryNotification) => void;
}

/**
 * Connection-level failures never produce an onResponse callback, so an
 * undefined status means the request died before HTTP — always worth a retry.
 */
export function isRetryable(status: number | undefined): boolean {
  return status === undefined || RETRYABLE_STATUS.has(status);
}

/**
 * `failedAttempt` is 1-based (the attempt that just failed). A server-sent
 * retry-after header (seconds or HTTP-date) takes precedence over the
 * exponential schedule; both are capped at MAX_DELAY_MS.
 */
export function computeDelay(failedAttempt: number, retryAfterHeader?: string): number {
  if (retryAfterHeader) {
    const secs = Number(retryAfterHeader);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, MAX_DELAY_MS);
    const date = Date.parse(retryAfterHeader);
    if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), MAX_DELAY_MS);
  }
  const exponential = BASE_DELAY_MS * 2 ** (failedAttempt - 1) + Math.random() * JITTER_MS;
  return Math.min(exponential, MAX_DELAY_MS);
}

/** Resolves true if aborted before the delay elapsed. */
function interruptibleDelay(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(true); return; }
    const onAbort = () => { cleanup(); resolve(true); };
    const timer = setTimeout(() => { cleanup(); resolve(false); }, ms);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Minimal assistant message for failures that bypass pi-ai's own error events. */
function syntheticErrorMessage(text: string, stopReason: 'error' | 'aborted'): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    stopReason,
    errorMessage: text,
  } as unknown as AssistantMessage;
}

/**
 * Wrap a StreamFn with first-token-safe retry. Failures arriving BEFORE any
 * content event has been forwarded downstream are retried with exponential
 * backoff (retry-after wins) up to MAX_ATTEMPTS; mid-stream failures, aborts,
 * and non-retryable statuses pass through untouched. The `start` event is
 * held back until the first content event so a retried attempt never
 * duplicates it downstream.
 */
export function withStreamRetry(inner: StreamFn, opts: WithStreamRetryOptions = {}): StreamFn {
  return (model, context, streamOpts) => {
    const out = createAssistantMessageEventStream();
    void pump(inner, model, context, streamOpts, out, opts);
    return out;
  };
}

/**
 * Internal driver for withStreamRetry: one iteration per attempt; terminal
 * events end the output stream.
 */
async function pump(
  inner: StreamFn,
  model: Parameters<StreamFn>[0],
  context: Parameters<StreamFn>[1],
  streamOpts: SimpleStreamOptions | undefined,
  out: AssistantMessageEventStream,
  opts: WithStreamRetryOptions,
): Promise<void> {
  try {
  const signal = streamOpts?.signal;
  const callerOnResponse = streamOpts?.onResponse;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let status: number | undefined;
    let retryAfter: string | undefined;
    const attemptOpts: SimpleStreamOptions = {
      ...streamOpts,
      onResponse: async (response, m) => {
        status = response.status;
        retryAfter = response.headers?.['retry-after'];
        try {
          await callerOnResponse?.(response, m);
        } catch (err) {
          // callerOnResponse threw; this may be called from a fire-and-forget
          // context (e.g. inside the inner StreamFn), so we catch here and push
          // a synthetic error directly rather than letting the rejection escape.
          out.push({
            type: 'error',
            reason: 'error',
            error: syntheticErrorMessage(err instanceof Error ? err.message : String(err), 'error'),
          });
          out.end();
        }
      },
    };

    let pendingStart: AssistantMessageEvent | undefined;
    let forwardedContent = false;

    const scheduleRetryOrGiveUp = async (errorEvent: AssistantMessageEvent & { type: 'error' }): Promise<'retry' | 'done'> => {
      if (errorEvent.reason === 'aborted' || forwardedContent || attempt >= MAX_ATTEMPTS || !isRetryable(status)) {
        out.push(errorEvent);
        out.end();
        return 'done';
      }
      const delayMs = computeDelay(attempt, retryAfter);
      opts.onRetry?.({ attempt: attempt + 1, maxAttempts: MAX_ATTEMPTS, delayMs, status });
      const aborted = await interruptibleDelay(delayMs, signal);
      if (aborted) {
        out.push({ type: 'error', reason: 'aborted', error: syntheticErrorMessage('aborted during retry backoff', 'aborted') });
        out.end();
        return 'done';
      }
      return 'retry';
    };

    let stream: AssistantMessageEventStream;
    try {
      stream = await inner(model, context, attemptOpts);
    } catch (err) {
      // pi-ai providers push error events rather than throwing; this path is
      // defensive against custom hooks.streamFn implementations.
      const outcome = await scheduleRetryOrGiveUp({
        type: 'error',
        reason: 'error',
        error: syntheticErrorMessage(err instanceof Error ? err.message : String(err), 'error'),
      });
      if (outcome === 'done') return;
      continue;
    }

    let retrying = false;
    for await (const event of stream) {
      if (event.type === 'start' && !forwardedContent) {
        pendingStart = event;
        continue;
      }
      if (event.type === 'error') {
        const outcome = await scheduleRetryOrGiveUp(event);
        if (outcome === 'done') return;
        retrying = true;
        break;
      }
      if (pendingStart) {
        out.push(pendingStart);
        pendingStart = undefined;
      }
      forwardedContent = true;
      out.push(event);
      if (event.type === 'done') {
        out.end();
        return;
      }
    }
    if (!retrying) {
      // Inner stream ended without done/error (contract violation) — surface it.
      out.push({ type: 'error', reason: 'error', error: syntheticErrorMessage('inner stream ended without terminal event', 'error') });
      out.end();
      return;
    }
  }
  } catch (err) {
    // Last-resort guard: pump is fire-and-forget, so nothing upstream can
    // catch a rejection from a misbehaving caller onResponse or StreamFn.
    out.push({
      type: 'error',
      reason: 'error',
      error: syntheticErrorMessage(err instanceof Error ? err.message : String(err), 'error'),
    });
    out.end();
  }
}
