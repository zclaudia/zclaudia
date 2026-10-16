import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { classifyErrorText } from './provider-business-codes.js';

export const MAX_ATTEMPTS = 5;
export const BASE_DELAY_MS = 1_000;
export const MAX_DELAY_MS = 60_000;
export const JITTER_MS = 250;
/**
 * Retry-After waits up to this ceiling are adopted verbatim; providers
 * legitimately return tens of seconds to a few minutes under rate limiting,
 * and capping those at MAX_DELAY_MS degrades a legal wait into a short local
 * backoff. Longer (or past) values fall back to the exponential schedule.
 * (Reference: ZCode apps/zcode-cli/packages/adapters/src/model/runner-retry.ts)
 */
export const MAX_REASONABLE_RETRY_AFTER_MS = 5 * 60_000;

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);

export interface RetryNotification {
  /** Upcoming attempt number (2..MAX_ATTEMPTS). */
  attempt: number;
  maxAttempts: number;
  /** Milliseconds to wait before the next attempt. */
  delayMs: number;
  /** HTTP status that triggered the retry; undefined for connection-level failures. */
  status?: number;
  /** Provider business code parsed from the error message when a classified
   * business code drove the retry (e.g. BigModel 1302 on an HTTP 200). */
  businessCode?: string;
}

export interface WithStreamRetryOptions {
  onRetry?: (info: RetryNotification) => void;
}

/** Extra signals that refine the plain HTTP-status retry verdict. */
export interface RetryabilityContext {
  /** Raw provider error message; scanned for business codes. */
  errorMessage?: string;
  /** Response headers; consulted for `x-should-retry`. */
  headers?: Record<string, string>;
}

/**
 * Connection-level failures never produce an onResponse callback, so an
 * undefined status means the request died before HTTP — always worth a retry.
 *
 * Business codes parsed from the error message take precedence over the
 * status verdict: a retryable code forces a retry even on status 200, while
 * a terminal code vetoes retry even on 5xx (quota/plan/fair-use failures do
 * not heal on retry). Unknown codes fall through to the status check. An
 * explicit `x-should-retry: false|0` header is an absolute provider veto and
 * wins over both.
 */
export function isRetryable(status: number | undefined, context?: RetryabilityContext): boolean {
  if (isXShouldRetryFalse(readHeader(context?.headers ?? {}, 'x-should-retry'))) return false;
  const classified = classifyErrorText(context?.errorMessage);
  if (classified) return classified.info.retryable;
  return status === undefined || RETRYABLE_STATUS.has(status);
}

/**
 * `failedAttempt` is 1-based (the attempt that just failed). A server-sent
 * retry-after-ms or retry-after header (seconds or HTTP-date) takes
 * precedence over the exponential schedule when reasonable (>= 0 and within
 * MAX_REASONABLE_RETRY_AFTER_MS, or shorter than the exponential delay
 * anyway); unreasonable values — past HTTP-dates, multi-hour waits — fall
 * back to the exponential schedule capped at MAX_DELAY_MS.
 */
export function computeDelay(
  failedAttempt: number,
  retryAfterHeader?: string,
  retryAfterMsHeader?: string
): number {
  const exponential = BASE_DELAY_MS * 2 ** (failedAttempt - 1) + Math.random() * JITTER_MS;
  const retryAfterMs = parseRetryAfterMs(retryAfterHeader, retryAfterMsHeader);
  if (isReasonableRetryAfterMs(retryAfterMs)) return retryAfterMs;
  return Math.min(exponential, MAX_DELAY_MS);
}

/** Parses retry-after-ms (ms) or retry-after (seconds / HTTP-date) into ms. */
function parseRetryAfterMs(
  retryAfterHeader?: string,
  retryAfterMsHeader?: string
): number | undefined {
  const ms = parseNonNegativeNumber(retryAfterMsHeader);
  if (ms !== undefined) return ms;
  const secs = parseNonNegativeNumber(retryAfterHeader);
  if (secs !== undefined) return secs * 1000;
  if (retryAfterHeader) {
    const date = Date.parse(retryAfterHeader);
    if (!Number.isNaN(date)) return date - Date.now();
  }
  return undefined;
}

function parseNonNegativeNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

// Reasonable = a wait within [0, MAX_REASONABLE_RETRY_AFTER_MS]; anything
// longer (or a past HTTP-date) falls back to the exponential schedule.
// ZCode's runner-retry.ts also accepts an over-ceiling wait when it is still
// shorter than the local exponential delay; that clause is unreachable here
// (the exponential schedule caps at MAX_DELAY_MS = 60s < 5min), so it is
// omitted to keep the >5min → exponential rule unconditional.
function isReasonableRetryAfterMs(
  retryAfterMs: number | undefined
): retryAfterMs is number {
  return (
    retryAfterMs !== undefined &&
    retryAfterMs >= 0 &&
    retryAfterMs <= MAX_REASONABLE_RETRY_AFTER_MS
  );
}

function readHeader(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

function isXShouldRetryFalse(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'false' || normalized === '0';
}

/** Resolves true if aborted before the delay elapsed. */
function interruptibleDelay(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise(resolve => {
    if (signal?.aborted) {
      resolve(true);
      return;
    }
    const onAbort = () => {
      cleanup();
      resolve(true);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, ms);
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
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
  opts: WithStreamRetryOptions
): Promise<void> {
  try {
    const signal = streamOpts?.signal;
    const callerOnResponse = streamOpts?.onResponse;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let status: number | undefined;
      let responseHeaders: Record<string, string> | undefined;
      const attemptOpts: SimpleStreamOptions = {
        ...streamOpts,
        onResponse: async (response, m) => {
          status = response.status;
          responseHeaders = response.headers;
          try {
            await callerOnResponse?.(response, m);
          } catch (err) {
            // callerOnResponse threw; this may be called from a fire-and-forget
            // context (e.g. inside the inner StreamFn), so we catch here and push
            // a synthetic error directly rather than letting the rejection escape.
            out.push({
              type: 'error',
              reason: 'error',
              error: syntheticErrorMessage(
                err instanceof Error ? err.message : String(err),
                'error'
              ),
            });
            out.end();
          }
        },
      };

      let pendingStart: AssistantMessageEvent | undefined;
      let forwardedContent = false;

      const scheduleRetryOrGiveUp = async (
        errorEvent: AssistantMessageEvent & { type: 'error' }
      ): Promise<'retry' | 'done'> => {
        const errorMessage = errorEvent.error.errorMessage;
        const classified = classifyErrorText(errorMessage);
        if (
          errorEvent.reason === 'aborted' ||
          forwardedContent ||
          attempt >= MAX_ATTEMPTS ||
          !isRetryable(status, { errorMessage, headers: responseHeaders })
        ) {
          out.push(errorEvent);
          out.end();
          return 'done';
        }
        const delayMs = computeDelay(
          attempt,
          readHeader(responseHeaders ?? {}, 'retry-after'),
          readHeader(responseHeaders ?? {}, 'retry-after-ms')
        );
        opts.onRetry?.({
          attempt: attempt + 1,
          maxAttempts: MAX_ATTEMPTS,
          delayMs,
          status,
          ...(classified?.info.retryable ? { businessCode: classified.code } : {}),
        });
        const aborted = await interruptibleDelay(delayMs, signal);
        if (aborted) {
          out.push({
            type: 'error',
            reason: 'aborted',
            error: syntheticErrorMessage('aborted during retry backoff', 'aborted'),
          });
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
        out.push({
          type: 'error',
          reason: 'error',
          error: syntheticErrorMessage('inner stream ended without terminal event', 'error'),
        });
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
