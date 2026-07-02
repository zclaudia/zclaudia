import { estimateTokens, type AgentMessage } from '@earendil-works/pi-agent-core';

/** Headroom for the summarization prompt scaffold itself (system + wrappers). */
export const SUMMARY_PROMPT_OVERHEAD_TOKENS = 4_000;

/** Floor so a small/odd window never yields a zero or negative chunk budget. */
export const MIN_SUMMARY_CHUNK_BUDGET = 8_000;

/**
 * Max estimated input tokens per summarization request. Leaves room for the
 * summary output (`summaryReserveTokens`), a rolled-up previous summary fed back
 * as input on later chunks (~ another summary's worth), and the prompt scaffold.
 * This is what lets a to-summarize history LARGER than the model's own window
 * still be compacted — without it, one `generateSummary` call overflows.
 */
export function summaryChunkBudget(contextWindow: number, summaryReserveTokens: number): number {
  const budget = contextWindow - summaryReserveTokens * 2 - SUMMARY_PROMPT_OVERHEAD_TOKENS;
  return Math.max(budget, MIN_SUMMARY_CHUNK_BUDGET);
}

/**
 * Greedily pack messages into chunks each ≤ `chunkBudget` estimated tokens. A
 * single message larger than the budget becomes its own (over-budget) chunk —
 * that's irreducible here without message-level truncation, so we surface it
 * rather than drop content.
 */
export function planSummaryChunks(
  messages: readonly AgentMessage[],
  chunkBudget: number,
  estimate: (m: AgentMessage) => number = estimateTokens
): AgentMessage[][] {
  const chunks: AgentMessage[][] = [];
  let current: AgentMessage[] = [];
  let currentTokens = 0;
  for (const m of messages) {
    const t = Math.max(0, estimate(m));
    if (current.length > 0 && currentTokens + t > chunkBudget) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(m);
    currentTokens += t;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export interface SummaryGenerateResult {
  ok: boolean;
  value?: string;
  error?: unknown;
}

/** Generate a summary for one chunk, optionally folding in the prior rollup. */
export type SummaryGenerator = (
  chunk: AgentMessage[],
  previousSummary: string | undefined
) => Promise<SummaryGenerateResult>;

/**
 * Summarize `messages` in window-sized chunks, chaining each chunk's summary
 * into the next via `previousSummary` (generateSummary's UPDATE prompt). Returns
 * the final rolled-up summary. Throws if any chunk fails so the caller can fall
 * back to the normal failure path.
 *
 * When everything fits in a single chunk this issues exactly one generate call —
 * identical to the non-chunked behavior, so normal compactions are unchanged.
 */
export async function summarizeChunked(opts: {
  messages: readonly AgentMessage[];
  chunkBudget: number;
  generate: SummaryGenerator;
  previousSummary?: string;
  estimate?: (m: AgentMessage) => number;
}): Promise<string> {
  const chunks = planSummaryChunks(opts.messages, opts.chunkBudget, opts.estimate);
  let running = opts.previousSummary;
  for (const chunk of chunks) {
    const result = await opts.generate(chunk, running);
    if (!result.ok) {
      throw result.error instanceof Error
        ? result.error
        : new Error(String(result.error ?? 'summary generation failed'));
    }
    running = result.value;
  }
  return running ?? '';
}
