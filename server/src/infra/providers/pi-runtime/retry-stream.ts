import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { classifyErrorText } from './provider-business-codes.js';

/**
 * Retry budget tiers and the env-tunable retry policy are adapted from ZCode
 * (Apache-2.0, Copyright 2026 Z.AI Co., Ltd.),
 * apps/zcode-cli/packages/adapters/src/model/retry-budget.ts and
 * apps/zcode-cli/packages/adapters/src/model/retry-policy.ts.
 * Deliberate deviations from the ZCode originals (semantics ported, not the
 * wiring):
 * - defaults keep this repo's historical hardcodes — 5 total attempts, 1s
 *   base delay, 2x backoff, 60s cap, 250ms additive jitter — instead of
 *   ZCode's 10-retries/2s-base/boolean-jitter policy;
 * - jitter is a millisecond magnitude added after exponentiation (this
 *   repo's curve), not ZCode's boolean half-to-full multiplier;
 * - env overrides use the ZCLAUDIA_MODEL_RETRY_* convention, and
 *   ZCLAUDIA_MODEL_RETRY_MAX_ATTEMPTS counts total attempts including the
 *   first (ZCode's ZCODE_MODEL_RETRY_MAX_RETRIES counts retries after it).
 * The `unbounded` tier ONLY relaxes the transient-failure give-up gates
 * (attempt loop + retry gate); the backoff curve, the retryability
 * classification, and the no-retry-after-content rule are untouched, so an
 * operator opting into unbounded retries cannot amplify a mid-stream
 * failure into an unbounded request storm.
 */

/** Retry budget tier for a model request (ported from ZCode's contract enum). */
export const ModelRetryBudget = {
  Default: 'default',
  Unbounded: 'unbounded',
  SingleAttempt: 'single-attempt',
} as const;
export type ModelRetryBudget = (typeof ModelRetryBudget)[keyof typeof ModelRetryBudget];

/** Status/notification `maxAttempts` sentinel for `unbounded` (Infinity is not serializable; 0 is not a legal count). */
export const UNBOUNDED_RETRY_MAX_ATTEMPTS = 0;
/** Total attempts (including the first) allowed under the `single-attempt` budget. */
export const SINGLE_ATTEMPT_MAX_ATTEMPTS = 1;

export function isUnboundedRetryBudget(budget: ModelRetryBudget | undefined): boolean {
  return budget === ModelRetryBudget.Unbounded;
}

export function isSingleAttemptRetryBudget(budget: ModelRetryBudget | undefined): boolean {
  return budget === ModelRetryBudget.SingleAttempt;
}

/** Resolves the policy actually in effect for a request under `budget`; the runner entry funnels through here so no call site special-cases tiers. */
export function resolveRetryOptionsForBudget(
  retry: ResolvedRetryPolicy,
  budget: ModelRetryBudget | undefined
): ResolvedRetryPolicy {
  return isSingleAttemptRetryBudget(budget)
    ? { ...retry, maxAttempts: SINGLE_ATTEMPT_MAX_ATTEMPTS }
    : retry;
}

/** May this (just-failed) attempt be followed by one more retry? `unbounded` is always true. */
export function retryBudgetAllows(
  budget: ModelRetryBudget | undefined,
  attempt: number,
  maxAttempts: number
): boolean {
  return isUnboundedRetryBudget(budget) || attempt < maxAttempts;
}

/** Attempt-loop continuation condition. `unbounded` is always true. */
export function retryAttemptLoopContinues(
  budget: ModelRetryBudget | undefined,
  attempt: number,
  loopMaxAttempts: number
): boolean {
  return isUnboundedRetryBudget(budget) || attempt <= loopMaxAttempts;
}

/** `maxAttempts` written into retry notifications / status: the 0 sentinel under `unbounded`. */
export function retryBudgetMaxAttempts(
  budget: ModelRetryBudget | undefined,
  maxAttempts: number
): number {
  return isUnboundedRetryBudget(budget) ? UNBOUNDED_RETRY_MAX_ATTEMPTS : maxAttempts;
}

export interface RetryPolicyOptions {
  /** Total attempts including the first. */
  maxAttempts?: number;
  baseDelayMs?: number;
  backoffFactor?: number;
  maxDelayMs?: number;
  /** Uniform jitter magnitude in ms added after exponentiation (this repo's curve). */
  jitterMs?: number;
}

export type ResolvedRetryPolicy = Required<RetryPolicyOptions>;

/** Defaults are this repo's historical hardcodes — behavior is unchanged unless env or options say otherwise. */
export const DEFAULT_RETRY_POLICY: ResolvedRetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1_000,
  backoffFactor: 2,
  maxDelayMs: 60_000,
  jitterMs: 250,
};

const ENV_RETRY_MAX_ATTEMPTS = 'ZCLAUDIA_MODEL_RETRY_MAX_ATTEMPTS';
const ENV_RETRY_BASE_DELAY_MS = 'ZCLAUDIA_MODEL_RETRY_BASE_DELAY_MS';
const ENV_RETRY_BACKOFF_FACTOR = 'ZCLAUDIA_MODEL_RETRY_BACKOFF_FACTOR';
const ENV_RETRY_MAX_DELAY_MS = 'ZCLAUDIA_MODEL_RETRY_MAX_DELAY_MS';
const ENV_RETRY_JITTER_MS = 'ZCLAUDIA_MODEL_RETRY_JITTER_MS';

type EnvRecord = Record<string, string | undefined>;

/**
 * Explicit options win over env, env over defaults (ported from ZCode's
 * resolveAiSdkModelRetryOptions; env is an explicit parameter so callers can
 * inject a scoped environment instead of reading the global one).
 */
export function resolveRetryPolicy(
  options: RetryPolicyOptions | undefined,
  env: EnvRecord
): ResolvedRetryPolicy {
  const envOptions = readRetryPolicyFromEnv(env);
  return {
    maxAttempts: normalizePositiveInteger(
      options?.maxAttempts,
      normalizePositiveInteger(envOptions.maxAttempts, DEFAULT_RETRY_POLICY.maxAttempts)
    ),
    baseDelayMs: normalizeNonNegativeInteger(
      options?.baseDelayMs,
      normalizeNonNegativeInteger(envOptions.baseDelayMs, DEFAULT_RETRY_POLICY.baseDelayMs)
    ),
    backoffFactor: normalizePositiveNumber(
      options?.backoffFactor,
      normalizePositiveNumber(envOptions.backoffFactor, DEFAULT_RETRY_POLICY.backoffFactor)
    ),
    maxDelayMs: normalizeNonNegativeInteger(
      options?.maxDelayMs,
      normalizeNonNegativeInteger(envOptions.maxDelayMs, DEFAULT_RETRY_POLICY.maxDelayMs)
    ),
    jitterMs: normalizeNonNegativeInteger(
      options?.jitterMs,
      normalizeNonNegativeInteger(envOptions.jitterMs, DEFAULT_RETRY_POLICY.jitterMs)
    ),
  };
}

function readRetryPolicyFromEnv(env: EnvRecord): RetryPolicyOptions {
  return {
    maxAttempts: parseNonNegativeInteger(env[ENV_RETRY_MAX_ATTEMPTS]),
    baseDelayMs: parseNonNegativeInteger(env[ENV_RETRY_BASE_DELAY_MS]),
    backoffFactor: parsePositiveNumber(env[ENV_RETRY_BACKOFF_FACTOR]),
    maxDelayMs: parseNonNegativeInteger(env[ENV_RETRY_MAX_DELAY_MS]),
    jitterMs: parseNonNegativeInteger(env[ENV_RETRY_JITTER_MS]),
  };
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.floor(parsed);
}

function parsePositiveNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function normalizePositiveNumber(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

/**
 * Retry-After waits up to this ceiling are adopted verbatim; providers
 * legitimately return tens of seconds to a few minutes under rate limiting,
 * and capping those at the policy's maxDelayMs (default 60s) degrades a legal
 * wait into a short local
 * backoff. Longer (or past) values fall back to the exponential schedule.
 * (Reference: ZCode apps/zcode-cli/packages/adapters/src/model/runner-retry.ts)
 */
export const MAX_REASONABLE_RETRY_AFTER_MS = 5 * 60_000;

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);

export interface RetryNotification {
  /** Upcoming attempt number (2..maxAttempts; `maxAttempts` is the 0 sentinel under the unbounded budget). */
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
  /** Explicit policy overrides; win over `env`, which wins over DEFAULT_RETRY_POLICY. */
  retry?: RetryPolicyOptions;
  /** Env record consulted for ZCLAUDIA_MODEL_RETRY_* overrides; defaults to process.env (read per request). */
  env?: EnvRecord;
  /** Retry budget tier; the default tier keeps the standard attempt cap. */
  budget?: ModelRetryBudget;
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
 * back to the exponential schedule capped at the policy's maxDelayMs.
 */
export function computeDelay(
  failedAttempt: number,
  retryAfterHeader?: string,
  retryAfterMsHeader?: string,
  policy: ResolvedRetryPolicy = DEFAULT_RETRY_POLICY
): number {
  const exponential =
    policy.baseDelayMs * policy.backoffFactor ** (failedAttempt - 1) +
    Math.random() * policy.jitterMs;
  const retryAfterMs = parseRetryAfterMs(retryAfterHeader, retryAfterMsHeader);
  if (isReasonableRetryAfterMs(retryAfterMs)) return retryAfterMs;
  return Math.min(exponential, policy.maxDelayMs);
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
// (the exponential schedule caps at the policy's maxDelayMs, 60s by default,
// < 5min), so it is
// omitted to keep the >5min → exponential rule unconditional.
function isReasonableRetryAfterMs(retryAfterMs: number | undefined): retryAfterMs is number {
  return (
    retryAfterMs !== undefined && retryAfterMs >= 0 && retryAfterMs <= MAX_REASONABLE_RETRY_AFTER_MS
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
 * backoff (retry-after wins) up to the resolved policy's maxAttempts;
 * mid-stream failures, aborts, and non-retryable statuses pass through
 * untouched. The `start` event is held back until the first content event so
 * a retried attempt never duplicates it downstream.
 *
 * Policy resolution happens per request (options > ZCLAUDIA_MODEL_RETRY_* env
 * > defaults), and `budget` selects the retry tier: `unbounded` relaxes only
 * the give-up gates — every retryable pre-content failure keeps being retried
 * — while `single-attempt` collapses maxAttempts to 1 so the first failure
 * surfaces immediately.
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

    // Resolved once per request: options > ZCLAUDIA_MODEL_RETRY_* env > defaults,
    // with the budget tier applied on top (single-attempt collapses maxAttempts).
    const budget = opts.budget;
    const policy = resolveRetryOptionsForBudget(
      resolveRetryPolicy(opts.retry, opts.env ?? process.env),
      budget
    );

    for (
      let attempt = 1;
      retryAttemptLoopContinues(budget, attempt, policy.maxAttempts);
      attempt++
    ) {
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
          !retryBudgetAllows(budget, attempt, policy.maxAttempts) ||
          !isRetryable(status, { errorMessage, headers: responseHeaders })
        ) {
          out.push(errorEvent);
          out.end();
          return 'done';
        }
        const delayMs = computeDelay(
          attempt,
          readHeader(responseHeaders ?? {}, 'retry-after'),
          readHeader(responseHeaders ?? {}, 'retry-after-ms'),
          policy
        );
        opts.onRetry?.({
          attempt: attempt + 1,
          maxAttempts: retryBudgetMaxAttempts(budget, policy.maxAttempts),
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
