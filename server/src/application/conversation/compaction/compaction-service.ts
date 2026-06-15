import {
  shouldCompact,
  estimateContextTokens,
  findCutPoint,
  generateSummary,
  DEFAULT_COMPACTION_SETTINGS,
  type AgentMessage,
} from '@earendil-works/pi-agent-core';
import type { Usage } from '@earendil-works/pi-ai';
import type { Database } from 'better-sqlite3';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import { newId } from '../../../utils/uuid.js';
import { SessionCompactionRepository } from '../../../domains/sessions/compaction-repository.js';
import { rebuildHistory } from '../../../infra/providers/pi-runtime/history-rebuilder.js';
import { buildModel } from '../../../infra/providers/pi-runtime/build-model.js';
import { resolveContextWindow } from './context-windows.js';
import { compactionCircuitBreaker } from './circuit-breaker.js';

export interface CompactionContext {
  db: Database;
  sessionId: string;
  agentProfile: AgentProfileConfig;
  llmProfile: LlmProfileConfig;
  /** Optional usage from the most recent assistant turn (currently unused — reserved for future smarter triggering). */
  lastAssistantUsage?: Usage;
  customInstructions?: string;
  source: 'auto' | 'manual' | 'overflow';
  signal?: AbortSignal;
  /** Injectable clock (ms since epoch). Defaults to Date.now(). */
  now?: number;
}

export interface CompactionOutcome {
  outcome: 'compacted' | 'skipped' | 'failed' | 'aborted';
  compacted: boolean;        // === (outcome === 'compacted'); kept for existing readers
  compactionId?: string;
  tokensBefore?: number;
  reason?: string;
  breaker?: { consecutiveFailures: number; breakerOpen: boolean; nextRetryAtMs?: number };
}

function skipped(reason: string, tokensBefore?: number, extra?: Partial<CompactionOutcome>): CompactionOutcome {
  return { outcome: 'skipped', compacted: false, reason, tokensBefore, ...extra };
}

function classifyFailure(ctx: CompactionContext, err: unknown, now: number): CompactionOutcome {
  const message = err instanceof Error ? err.message : String(err);
  const aborted = ctx.signal?.aborted === true || (err instanceof Error && err.name === 'AbortError');
  if (aborted) {
    return { outcome: 'aborted', compacted: false, reason: `aborted: ${message}` };
  }
  compactionCircuitBreaker.recordFailure(ctx.sessionId, now);
  return {
    outcome: 'failed',
    compacted: false,
    reason: `error: ${message}`,
    breaker: compactionCircuitBreaker.snapshot(ctx.sessionId),
  };
}

/**
 * Auto entry — checks `shouldCompact` against the resolved context window and
 * runs compaction only when the threshold is exceeded. Intended for the
 * `agent_end` hook in run-events.
 *
 * This is the SOLE breaker mutation point for automatic compaction.
 */
export async function maybeCompact(ctx: CompactionContext): Promise<CompactionOutcome> {
  const now = ctx.now ?? Date.now();
  const decision = compactionCircuitBreaker.evaluate(ctx.sessionId, now);
  if (decision.action === 'skip') {
    return skipped('circuit_open', undefined, {
      // When we skip, the breaker is open by definition; pin breakerOpen=true in
      // case a concurrent recordSuccess/reset raced between evaluate() and snapshot().
      breaker: { ...compactionCircuitBreaker.snapshot(ctx.sessionId), breakerOpen: true },
    });
  }
  try {
    const { messages, dbIds } = rebuildHistory(ctx.db, ctx.sessionId);
    if (messages.length === 0) return skipped('no_messages');
    const tokens = estimateContextTokens(messages).tokens;
    const window = resolveContextWindow(ctx.agentProfile, undefined, ctx.llmProfile).value;
    if (!shouldCompact(tokens, window, DEFAULT_COMPACTION_SETTINGS)) {
      return skipped('below_threshold', tokens);
    }
    const result = await runCompaction(ctx, messages, dbIds, tokens);
    if (result.outcome === 'compacted') compactionCircuitBreaker.recordSuccess(ctx.sessionId);
    return result;
  } catch (err) {
    return classifyFailure(ctx, err, now);
  }
}

/**
 * Manual entry — skips the threshold check and always attempts compaction.
 * Intended for the `/compact` slash command (T6). Still respects
 * `keepRecentTokens` so the most recent turn(s) are preserved verbatim;
 * we only skip the "is context full enough" gate.
 *
 * On short conversations where everything fits inside the keep-recent budget,
 * this correctly returns `no_cut_point` — there's nothing meaningful to
 * compact.
 *
 * Does NOT consult the circuit breaker. Resets the breaker on success so that
 * a successful manual compact clears any accumulated failure state.
 */
export async function forceCompact(ctx: CompactionContext): Promise<CompactionOutcome> {
  try {
    const { messages, dbIds } = rebuildHistory(ctx.db, ctx.sessionId);
    if (messages.length === 0) return skipped('no_messages');
    const tokens = estimateContextTokens(messages).tokens;
    const result = await runCompaction(ctx, messages, dbIds, tokens);
    if (result.outcome === 'compacted') compactionCircuitBreaker.reset(ctx.sessionId);
    return result;
  } catch (err) {
    // Manual /compact failures are surfaced to the user directly and must NOT
    // call recordFailure — they do not trip the auto-compaction breaker.
    const message = err instanceof Error ? err.message : String(err);
    return { outcome: 'failed', compacted: false, reason: `error: ${message}` };
  }
}

/**
 * Overflow-recovery entry — invoked from handleRunException when the provider
 * rejected a turn for exceeding the context window. Breaker-gated (so a
 * compaction that itself keeps failing won't storm), but SKIPS the
 * `shouldCompact` threshold gate: the provider already told us we're over, and
 * our local chars/4 estimate is exactly the thing that disagreed. Records
 * breaker success/failure like `maybeCompact`.
 *
 * Returns `skipped('no_cut_point')` when the most recent turn alone exceeds the
 * keep-recent budget — the caller must then fall through to normal failure
 * (retrying would just overflow again).
 */
export async function compactForOverflow(ctx: CompactionContext): Promise<CompactionOutcome> {
  const now = ctx.now ?? Date.now();
  const decision = compactionCircuitBreaker.evaluate(ctx.sessionId, now);
  if (decision.action === 'skip') {
    return skipped('circuit_open', undefined, {
      breaker: { ...compactionCircuitBreaker.snapshot(ctx.sessionId), breakerOpen: true },
    });
  }
  try {
    const { messages, dbIds } = rebuildHistory(ctx.db, ctx.sessionId);
    if (messages.length === 0) return skipped('no_messages');
    const tokens = estimateContextTokens(messages).tokens;
    const result = await runCompaction(ctx, messages, dbIds, tokens);
    if (result.outcome === 'compacted') compactionCircuitBreaker.recordSuccess(ctx.sessionId);
    return result;
  } catch (err) {
    return classifyFailure(ctx, err, now);
  }
}

/**
 * Wrap a flat `Message[]` into a minimal `SessionTreeEntry[]` of `type:
 * 'message'` so we can call pi's `findCutPoint` (which expects entries, not
 * raw messages). The fake ids/parentIds/timestamps satisfy the
 * `SessionTreeEntryBase` shape — `findCutPoint` only inspects `entry.type`
 * and `entry.message`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapAsEntries(messages: AgentMessage[]): any[] {
  return messages.map((message, i) => ({
    type: 'message',
    id: `e${i}`,
    parentId: i === 0 ? null : `e${i - 1}`,
    timestamp: '0',
    message,
  }));
}

async function runCompaction(
  ctx: CompactionContext,
  messages: AgentMessage[],
  dbIds: (string | null)[],
  tokens: number,
): Promise<CompactionOutcome> {
  const entries = wrapAsEntries(messages);
  const cut = findCutPoint(entries, 0, entries.length, DEFAULT_COMPACTION_SETTINGS.keepRecentTokens);
  if (cut.firstKeptEntryIndex <= 0) {
    return skipped('no_cut_point', tokens);
  }
  const firstKeptDbId = dbIds[cut.firstKeptEntryIndex];
  if (!firstKeptDbId) {
    return skipped('cut_point_unmappable', tokens);
  }
  const toSummarize = messages.slice(0, cut.firstKeptEntryIndex);

  // Build the model with the agent's model id over the llm profile config so
  // compaction uses the SAME provider/model the session is already using. A
  // separate summarizer model is intentionally NOT introduced in this pass.
  const built = buildModel(ctx.llmProfile, ctx.agentProfile.model);

  const result = await generateSummary(
    toSummarize,
    built.model,
    DEFAULT_COMPACTION_SETTINGS.reserveTokens,
    ctx.llmProfile.apiKey ?? '',
    undefined,                          // headers
    ctx.signal,
    ctx.customInstructions,
    undefined,                          // previousSummary — chained-compaction follow-up
    ctx.agentProfile.thinkingLevel,
  );
  if (!result.ok) {
    throw result.error instanceof Error ? result.error : new Error(String(result.error));
  }

  const created = new SessionCompactionRepository(ctx.db).create({
    id: newId(),
    sessionId: ctx.sessionId,
    summary: result.value,
    firstKeptMessageId: firstKeptDbId,
    tokensBefore: tokens,
    // File-op extraction is a follow-up — pi's extractFileOpsFromMessage lives
    // on the harness path and isn't re-exported from the main barrel.
    details: { readFiles: [], modifiedFiles: [] },
    source: ctx.source,
    customInstructions: ctx.customInstructions,
    createdAt: Date.now(),
  });
  return { outcome: 'compacted', compacted: true, compactionId: created.id, tokensBefore: tokens };
}
