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

export interface CompactionContext {
  db: Database;
  sessionId: string;
  agentProfile: AgentProfileConfig;
  llmProfile: LlmProfileConfig;
  /** Optional usage from the most recent assistant turn (currently unused — reserved for future smarter triggering). */
  lastAssistantUsage?: Usage;
  customInstructions?: string;
  source: 'auto' | 'manual';
  signal?: AbortSignal;
}

export interface CompactionOutcome {
  compacted: boolean;
  compactionId?: string;
  tokensBefore?: number;
  reason?: string;
}

/**
 * Auto entry — checks `shouldCompact` against the resolved context window and
 * runs compaction only when the threshold is exceeded. Intended for the
 * `agent_end` hook in run-events.
 */
export async function maybeCompact(ctx: CompactionContext): Promise<CompactionOutcome> {
  const { messages, dbIds } = rebuildHistory(ctx.db, ctx.sessionId);
  if (messages.length === 0) return { compacted: false, reason: 'no_messages' };
  const tokens = estimateContextTokens(messages).tokens;
  const window = resolveContextWindow(ctx.agentProfile, undefined, ctx.llmProfile).value;
  if (!shouldCompact(tokens, window, DEFAULT_COMPACTION_SETTINGS)) {
    return { compacted: false, tokensBefore: tokens, reason: 'below_threshold' };
  }
  return runCompaction(ctx, messages, dbIds, tokens);
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
 */
export async function forceCompact(ctx: CompactionContext): Promise<CompactionOutcome> {
  const { messages, dbIds } = rebuildHistory(ctx.db, ctx.sessionId);
  if (messages.length === 0) return { compacted: false, reason: 'no_messages' };
  const tokens = estimateContextTokens(messages).tokens;
  return runCompaction(ctx, messages, dbIds, tokens);
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
    return { compacted: false, tokensBefore: tokens, reason: 'no_cut_point' };
  }
  const firstKeptDbId = dbIds[cut.firstKeptEntryIndex];
  if (!firstKeptDbId) {
    return { compacted: false, tokensBefore: tokens, reason: 'cut_point_unmappable' };
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
    const message = result.error instanceof Error ? result.error.message : String(result.error);
    return { compacted: false, tokensBefore: tokens, reason: `error: ${message}` };
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
  return { compacted: true, compactionId: created.id, tokensBefore: tokens };
}
