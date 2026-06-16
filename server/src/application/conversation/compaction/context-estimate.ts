import { estimateContextTokens, type AgentMessage } from '@earendil-works/pi-agent-core';

/**
 * Output tokens reserved for the compaction summary itself (matches the budget
 * passed to `generateSummary`). Subtracted from the window before deciding
 * whether to compact so the summarizer always has room to run.
 */
export const COMPACTION_SUMMARY_RESERVE_TOKENS = 16_384;

/**
 * Extra headroom subtracted from the window when deciding whether to compact.
 * Proactive compaction must fire BEFORE one more turn's growth + estimation
 * error can push the next request past the window. The local token estimate
 * also omits the system prompt and tool JSON schemas entirely, so the buffer
 * absorbs that blind spot too. Together with the summary reserve this lands the
 * trigger at ~85% of the window (cf. pi's bare 94%), mirroring openclaude's
 * summary-reserve + autocompact-buffer split.
 */
export const COMPACTION_TRIGGER_BUFFER_TOKENS = 24_000;

/** Token count above which proactive compaction should fire for a given window. */
export function compactionTriggerThreshold(contextWindow: number): number {
  return contextWindow - COMPACTION_SUMMARY_RESERVE_TOKENS - COMPACTION_TRIGGER_BUFFER_TOKENS;
}

/**
 * Prompt-token count — `input + cacheRead + cacheWrite`, i.e. the real size of
 * the request's context as the provider counted it, EXCLUDING output — from the
 * most recent assistant message that carries usage. This is the right basis for
 * "how full is the window", unlike pi's `calculateContextTokens` which uses
 * `totalTokens` (prompt + output). Returns undefined when no usable usage
 * exists; skips error/aborted turns (their usage is unreliable).
 */
export function lastAssistantPromptTokens(messages: readonly AgentMessage[]): number | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as {
      role?: string;
      stopReason?: string;
      usage?: { input?: number; cacheRead?: number; cacheWrite?: number };
    };
    if (m?.role !== 'assistant') continue;
    if (m.stopReason === 'aborted' || m.stopReason === 'error') continue;
    const u = m.usage;
    if (!u) continue;
    const prompt = (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
    if (prompt > 0) return prompt;
  }
  return undefined;
}

/**
 * Context-token estimate for the proactive-compaction threshold. Prefers the
 * real prompt-token count from the last assistant response; falls back to pi's
 * chars/4 estimate when there is no usage OR when the stored usage is physically
 * impossible for a single request (> window — a turn-aggregate, or a proxy that
 * reports cumulative cache tokens). Returns the larger of the two sane
 * candidates so neither an undercount nor a stale anchor can suppress a needed
 * compaction.
 *
 * `charsEstimator` is injectable for tests; it defaults to pi's
 * `estimateContextTokens` (chars/4 with a usage-anchored fast path).
 */
export function estimateContextTokensForThreshold(
  messages: readonly AgentMessage[],
  contextWindow: number,
  charsEstimator: (m: readonly AgentMessage[]) => number = (m) =>
    estimateContextTokens(m as AgentMessage[]).tokens,
): number {
  const charsEstimate = charsEstimator(messages);
  const anchor = lastAssistantPromptTokens(messages);
  const saneAnchor = anchor != null && anchor <= contextWindow ? anchor : 0;
  return Math.max(saneAnchor, charsEstimate);
}
