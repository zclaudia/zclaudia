import { estimateTokens, type AgentMessage } from '@earendil-works/pi-agent-core';

/**
 * Pure character-based context estimate (chars/4 over message content), summed
 * per message. Unlike pi's `estimateContextTokens` it NEVER consults the last
 * assistant `usage`, so a proxy that reports cumulative/bogus cache tokens
 * cannot poison it. This is the default basis for the proactive-compaction
 * estimate; see `estimateContextTokensForThreshold`.
 */
export function structuralContextTokens(messages: readonly AgentMessage[]): number {
  let total = 0;
  for (const m of messages) total += estimateTokens(m as AgentMessage);
  return total;
}

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
 * Both candidates are window-safe against a misbehaving provider: the `anchor`
 * is dropped when it exceeds the window, and `charsEstimator` defaults to the
 * usage-free {@link structuralContextTokens} (NOT pi's usage-anchored
 * `estimateContextTokens`). Together this means a proxy reporting cumulative or
 * otherwise bogus cache tokens can no longer inflate the estimate and trigger
 * compaction on every turn. `charsEstimator` stays injectable for tests.
 */
export function estimateContextTokensForThreshold(
  messages: readonly AgentMessage[],
  contextWindow: number,
  charsEstimator: (m: readonly AgentMessage[]) => number = structuralContextTokens,
): number {
  const charsEstimate = charsEstimator(messages);
  const anchor = lastAssistantPromptTokens(messages);
  const saneAnchor = anchor != null && anchor <= contextWindow ? anchor : 0;
  return Math.max(saneAnchor, charsEstimate);
}

/** Extra margin so filling history never by itself reaches the compaction
 * trigger threshold (avoids fill↔compact thrash). */
export const HISTORY_BUDGET_MARGIN_TOKENS = 8_000;

/** Token budget for rebuilt history fed to the model: kept strictly below the
 * proactive-compaction threshold. */
export function historyTokenBudget(contextWindow: number): number {
  return Math.max(0, compactionTriggerThreshold(contextWindow) - HISTORY_BUDGET_MARGIN_TOKENS);
}
