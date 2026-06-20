import {
  estimateContextTokens,
  generateSummary,
  prepareCompaction,
  Session,
  DEFAULT_COMPACTION_SETTINGS,
  type AgentMessage,
  type SessionTreeEntry,
} from '@earendil-works/pi-agent-core';
import {
  compactionTriggerThreshold,
  estimateContextTokensForThreshold,
} from './context-estimate.js';
import { summarizeChunked, summaryChunkBudget } from './chunked-summary.js';
import type { Usage } from '@earendil-works/pi-ai';
import type { Database } from 'better-sqlite3';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import { SqliteSessionStorage } from '../../../infra/providers/pi-runtime/session-tree/index.js';
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
  source: 'auto' | 'manual' | 'overflow' | 'preflight';
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
    const { session, branch, messages } = await loadTreeSnapshot(ctx);
    if (messages.length === 0) return skipped('no_messages');
    const window = resolveContextWindow(ctx.agentProfile, undefined, ctx.llmProfile).value;
    // Threshold input is the real prompt-token count from the last response's
    // usage (prompt only, bogus >window values rejected), not pi's totalTokens
    // estimate; the trigger sits ~15% below the window so a turn's growth +
    // estimation error can't overrun it. See context-estimate.ts.
    const tokens = estimateContextTokensForThreshold(messages, window);
    const threshold = compactionTriggerThreshold(window);
    const willCompact = tokens > threshold;
    // Diagnostic: one line per turn showing the proactive-compaction decision
    // inputs. Lets us tell "estimate never crossed the threshold" apart from
    // "threshold tripped but the cut/summary failed" when a session overflows.
    console.log(`[Compaction] auto eval session=${ctx.sessionId} estimate=${tokens} window=${window} threshold=${threshold} willCompact=${willCompact}`);
    if (!willCompact) {
      return skipped('below_threshold', tokens);
    }
    const result = await runCompaction(ctx, session, branch, tokens);
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
    const { session, branch, messages } = await loadTreeSnapshot(ctx);
    if (messages.length === 0) return skipped('no_messages');
    const tokens = estimateContextTokens(messages).tokens;
    const result = await runCompaction(ctx, session, branch, tokens);
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
    const { session, branch, messages } = await loadTreeSnapshot(ctx);
    if (messages.length === 0) return skipped('no_messages');
    const tokens = estimateContextTokens(messages).tokens;
    const result = await runCompaction(ctx, session, branch, tokens);
    if (result.outcome === 'compacted') compactionCircuitBreaker.recordSuccess(ctx.sessionId);
    return result;
  } catch (err) {
    return classifyFailure(ctx, err, now);
  }
}

/** Snapshot of the session tree's active branch + its projected context messages. */
interface TreeSnapshot {
  session: Session;
  /** Root→leaf path entries (what pi's prepareCompaction consumes). */
  branch: SessionTreeEntry[];
  /** buildContext projection — used for the token estimate / threshold decision. */
  messages: AgentMessage[];
}

/** Load the session tree's active branch and its projected messages (Route C). */
async function loadTreeSnapshot(ctx: CompactionContext): Promise<TreeSnapshot> {
  const session = new Session(new SqliteSessionStorage(ctx.db, ctx.sessionId));
  const branch = await session.getBranch();
  const messages = (await session.buildContext()).messages;
  return { session, branch, messages };
}

export interface TreeCompactionInput {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details: { source: string; customInstructions: string | null; readFiles: string[]; modifiedFiles: string[] };
}

/**
 * Append a native pi `CompactionEntry` to the session tree and return its id.
 * `appendCompaction` over `SqliteSessionStorage` advances the leaf to the new
 * entry, so the next `buildContext` honors the boundary natively (drops
 * pre-boundary history, prepends the summary). Replaces the old
 * `session_compactions` table write.
 */
export async function appendCompactionToTree(session: Session, input: TreeCompactionInput): Promise<string> {
  return session.appendCompaction(input.summary, input.firstKeptEntryId, input.tokensBefore, input.details, false);
}

/** Mirror of pi's (non-exported) computeFileLists: modified = written ∪ edited; read-only excludes modified. */
function computeFileLists(
  fileOps: { read: Set<string>; written: Set<string>; edited: Set<string> },
): { readFiles: string[]; modifiedFiles: string[] } {
  const modified = new Set([...fileOps.edited, ...fileOps.written]);
  const readFiles = [...fileOps.read].filter((f) => !modified.has(f)).sort();
  const modifiedFiles = [...modified].sort();
  return { readFiles, modifiedFiles };
}

async function runCompaction(
  ctx: CompactionContext,
  session: Session,
  branch: SessionTreeEntry[],
  tokens: number,
): Promise<CompactionOutcome> {
  // pi resolves the cut point natively over the tree entries — no fake-entry
  // wrapping or DB-id parallel array. `undefined` means no meaningful cut point
  // (recent budget already covers everything).
  const prep = prepareCompaction(branch, DEFAULT_COMPACTION_SETTINGS);
  if (!prep.ok) {
    throw prep.error instanceof Error ? prep.error : new Error(String(prep.error));
  }
  const preparation = prep.value;
  // pi returns a preparation even when the cut sits at the branch start (nothing
  // to summarize) — e.g. the recent-token budget already covers the whole
  // history. Treat that as no cut point, matching the prior findCutPoint<=0 gate.
  if (!preparation || (preparation.messagesToSummarize.length === 0 && preparation.turnPrefixMessages.length === 0)) {
    return skipped('no_cut_point', tokens);
  }
  const toSummarize = preparation.messagesToSummarize;

  // Build the model with the agent's model id over the llm profile config so
  // compaction uses the SAME provider/model the session is already using. A
  // separate summarizer model is intentionally NOT introduced in this pass.
  const built = buildModel(ctx.llmProfile, ctx.agentProfile.model);

  // Summarize in window-sized chunks so a to-summarize history LARGER than the
  // model's own context window (e.g. after switching to a smaller-window model)
  // can still be compacted — a single generateSummary call would itself overflow
  // and fail the whole compaction. Each chunk's summary is chained into the next
  // via previousSummary. A history that fits in one chunk issues exactly one
  // call, unchanged from before.
  const window = resolveContextWindow(ctx.agentProfile, undefined, ctx.llmProfile).value;
  const chunkBudget = summaryChunkBudget(window, DEFAULT_COMPACTION_SETTINGS.reserveTokens);
  const summary = await summarizeChunked({
    messages: toSummarize,
    chunkBudget,
    // Seed the rollup with any prior compaction's summary so iterative
    // compactions UPDATE rather than re-summarize from scratch (pi semantics).
    previousSummary: preparation.previousSummary,
    generate: (chunk, previousSummary) => generateSummary(
      chunk,
      built.model,
      DEFAULT_COMPACTION_SETTINGS.reserveTokens,
      ctx.llmProfile.apiKey ?? '',
      undefined,                          // headers
      ctx.signal,
      ctx.customInstructions,
      previousSummary,
      ctx.agentProfile.thinkingLevel,
    ),
  });

  // pi extracts real file operations from the summarized history; project them
  // into the UI's read/modified lists (previously stubbed empty).
  const { readFiles, modifiedFiles } = computeFileLists(preparation.fileOps);
  const compactionId = await appendCompactionToTree(session, {
    summary,
    firstKeptEntryId: preparation.firstKeptEntryId,
    tokensBefore: tokens,
    details: {
      source: ctx.source,
      customInstructions: ctx.customInstructions ?? null,
      readFiles,
      modifiedFiles,
    },
  });
  return { outcome: 'compacted', compacted: true, compactionId, tokensBefore: tokens };
}
