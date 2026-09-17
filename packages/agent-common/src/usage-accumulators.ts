/**
 * Per-runtime invocation usage accumulators (design §5).
 *
 * Each accumulator turns a runtime's raw usage evidence into cumulative
 * invocation snapshots (design §4): the emitted value is ALWAYS the current
 * accumulated state of the invocation, never a per-request delta, and the
 * host replaces stored snapshots by (invocationId, revision).
 *
 * Conservative by contract: a path whose metering range has not been
 * verified for the pinned runtime version must downgrade to partial/missing,
 * never claim complete.
 */
import type {
  CodexTokenUsageCounters,
  RuntimeUsageSnapshot,
  UsageModelAllocation,
  UsageTokenBreakdown,
} from './usage-snapshot.js';
import {
  addKnownBreakdowns,
  breakdownHasKnownValue,
  buildInvocationSnapshot,
  emptyBreakdown,
  missingUsageSnapshot,
  USAGE_SNAPSHOT_SCHEMA_VERSION,
} from './usage-snapshot.js';

export type { UsageModelAllocation };

// === Claude Code ===

/** Claude SDK assistant message usage (snake_case wire shape). */
export interface ClaudeAssistantUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface ClaudeAssistantUsageEvent {
  /** SDK message id; the same id may arrive more than once (replays/parallel emit). */
  messageId?: string;
  /** Main-agent calls only — sub-agent messages never enter the accumulator. */
  isSubagent: boolean;
  usage: ClaudeAssistantUsage;
}

interface ClaudeModelUsageEntry {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface ClaudeResultEvidence {
  usage?: ClaudeAssistantUsage;
  /** Per-model cumulative usage for the call (`result.modelUsage`). */
  modelUsage?: Record<string, ClaudeModelUsageEntry>;
  errored: boolean;
}

function breakdownFromClaudeUsage(usage: ClaudeAssistantUsage): UsageTokenBreakdown {
  const inputUncached = usage.input_tokens ?? null;
  const cacheRead = usage.cache_read_input_tokens ?? null;
  const cacheWrite = usage.cache_creation_input_tokens ?? null;
  const output = usage.output_tokens ?? null;
  const known = [inputUncached, cacheRead, cacheWrite, output].filter(
    (v): v is number => v !== null
  );
  return {
    inputUncached,
    cacheRead,
    cacheWrite,
    output,
    reasoningOutput: null,
    total: known.length === 4 ? known.reduce((sum, value) => sum + value, 0) : null,
  };
}

/**
 * Claude Code accumulator (design §5.1).
 *
 * - Assistant usage events are deduped by message id: a repeated id counts
 *   once; when the same id later reports larger numbers (streamed
 *   settlement), the contribution grows by the difference instead of adding.
 * - A clean `result` is the authoritative end-of-call range: result.usage
 *   (main loop) when modelUsage is absent, otherwise the per-model records
 *   with the invocation total being their sum.
 * - Sub-agent inclusion in modelUsage is NOT verified for the pinned SDK
 *   version, so snapshots declare `includesSubagents: 'unknown'` and result/
 *   modelUsage conflicts are recorded as a discrepancy instead of being
 *   forced into a bucket.
 */
export class ClaudeUsageAccumulator {
  private revision = 0;
  private readonly seenMessages = new Map<string, UsageTokenBreakdown>();
  private accumulated: UsageTokenBreakdown = emptyBreakdown();
  private sawAnyUsage = false;

  /** Mid-call snapshot from assistant message usage; null when nothing new. */
  onAssistantUsage(event: ClaudeAssistantUsageEvent): RuntimeUsageSnapshot | null {
    if (event.isSubagent) return null;
    const next = breakdownFromClaudeUsage(event.usage);
    if (!breakdownHasKnownValue(next)) return null;

    const key = event.messageId ?? `anon:${this.seenMessages.size}`;
    const previous = this.seenMessages.get(key);
    if (previous) {
      const growth = usageGrowth(previous, next);
      if (!growth) return null; // identical replay — already counted once
      this.seenMessages.set(key, next);
      this.accumulated = addKnownBreakdowns(this.accumulated, growth);
    } else {
      this.seenMessages.set(key, next);
      this.accumulated = addKnownBreakdowns(this.accumulated, next);
    }
    this.sawAnyUsage = true;
    this.revision += 1;
    return buildInvocationSnapshot({
      revision: this.revision,
      final: false,
      status: 'partial',
      tokens: this.accumulated,
      sourceKind: 'claude_assistant_usage',
      includesSubagents: 'no',
    });
  }

  /** Final snapshot from the SDK result evidence. */
  onResult(evidence: ClaudeResultEvidence): RuntimeUsageSnapshot {
    this.revision += 1;
    let modelAllocations: UsageModelAllocation[] = evidence.modelUsage
      ? Object.entries(evidence.modelUsage).map(([modelId, entry]) => ({
          modelId,
          tokens: breakdownFromClaudeUsage({
            input_tokens: entry.inputTokens,
            output_tokens: entry.outputTokens,
            cache_read_input_tokens: entry.cacheReadInputTokens,
            cache_creation_input_tokens: entry.cacheCreationInputTokens,
          }),
        }))
      : [];

    let tokens: UsageTokenBreakdown;
    let discrepancy: string | undefined;
    if (modelAllocations.length > 0) {
      const modelSum = modelAllocations.reduce(
        (acc, entry) => addKnownBreakdowns(acc, entry.tokens),
        emptyBreakdown()
      );
      tokens = modelSum;
      if (evidence.usage) {
        const resultUsage = breakdownFromClaudeUsage(evidence.usage);
        if (resultUsage.total !== null && modelSum.total === null) {
          tokens = resultUsage;
          discrepancy =
            'modelUsage has no known total; retained result.usage without model allocation';
          modelAllocations = [];
        } else if (resultUsage.total !== null && modelSum.total !== null) {
          if (resultUsage.total > modelSum.total) {
            // The main-loop result claims more than the per-model records —
            // containment unclear: keep the reported total auditable and let
            // the host bucket it into Unknown model.
            discrepancy = `result.usage.totalTokens=${resultUsage.total} exceeds sum(modelUsage)=${modelSum.total}`;
            tokens = resultUsage;
          } else if (resultUsage.total < modelSum.total) {
            discrepancy = `result.usage.totalTokens=${resultUsage.total} is below sum(modelUsage)=${modelSum.total} (modelUsage may include sub-agents)`;
          }
        }
      }
    } else if (evidence.usage) {
      tokens = breakdownFromClaudeUsage(evidence.usage);
    } else {
      tokens = this.accumulated;
    }

    // A crashed SDK can zero its result counters after reporting real usage.
    // Preserve the earlier evidence rather than replacing it with a zero.
    if (evidence.errored && (tokens.total ?? 0) === 0 && this.sawAnyUsage) {
      tokens = this.accumulated;
      modelAllocations = [];
    }
    const hasResultEvidence =
      Object.values(evidence.usage ?? {}).some(v => typeof v === 'number') ||
      Object.values(evidence.modelUsage ?? {}).some(entry =>
        Object.values(entry).some(v => typeof v === 'number')
      );
    if (!hasResultEvidence) tokens = this.accumulated;

    const incompleteClassification =
      [tokens.inputUncached, tokens.cacheRead, tokens.cacheWrite, tokens.output].some(
        v => v === null
      ) ||
      modelAllocations.some(({ tokens: model }) =>
        [model.inputUncached, model.cacheRead, model.cacheWrite, model.output].some(v => v === null)
      );
    // A zeroed error without earlier observations is a placeholder, not proof
    // that no model request consumed tokens.
    if (evidence.errored && !this.sawAnyUsage && tokens.total === 0) {
      return missingUsageSnapshot(
        'claude_result',
        this.revision,
        true,
        'error_result_without_usage'
      );
    }

    if (!breakdownHasKnownValue(tokens)) {
      if (!this.sawAnyUsage) {
        return missingUsageSnapshot(
          'claude_result',
          this.revision,
          true,
          evidence.errored ? 'error_result_without_usage' : 'result_without_usage'
        );
      }
      tokens = this.accumulated;
    }
    return buildInvocationSnapshot({
      revision: this.revision,
      final: true,
      // Run status and usage status are independent: an errored result still
      // ends the metered range, but completeness is only claimable for a
      // clean result — an error result's coverage of the executed range is
      // unproven.
      status:
        evidence.errored || !hasResultEvidence || discrepancy || incompleteClassification
          ? 'partial'
          : 'complete',
      reason: evidence.errored
        ? 'error_result'
        : !hasResultEvidence
          ? 'result_without_usage'
          : discrepancy
            ? 'uncertain_model_scope'
            : incompleteClassification
              ? 'incomplete_classification'
              : undefined,
      discrepancy,
      tokens,
      models: modelAllocations,
      sourceKind: 'claude_result',
      includesSubagents: 'unknown',
    });
  }

  /** Crash/interrupt without a result: settle what was observed. */
  onInterrupted(reason = 'interrupted'): RuntimeUsageSnapshot {
    this.revision += 1;
    if (!this.sawAnyUsage) {
      return missingUsageSnapshot('claude_assistant_usage', this.revision, true, reason);
    }
    return buildInvocationSnapshot({
      revision: this.revision,
      final: true,
      status: 'partial',
      reason,
      tokens: this.accumulated,
      sourceKind: 'claude_assistant_usage',
      includesSubagents: 'no',
    });
  }
}

/** Per-field growth of a repeated message observation; null when nothing grew. */
function usageGrowth(
  previous: UsageTokenBreakdown,
  next: UsageTokenBreakdown
): UsageTokenBreakdown | null {
  // A replay with regressed fields cannot replace the dedupe baseline:
  // otherwise the subsequent normal observation would count that range twice.
  if (
    (Object.keys(previous) as Array<keyof UsageTokenBreakdown>).some(key => {
      const prior = previous[key];
      const current = next[key];
      return prior !== null && current !== null && current < prior;
    })
  )
    return null;
  const delta = (prev: number | null, nxt: number | null): number | null => {
    if (nxt === null) return null;
    if (prev === null) return nxt;
    return nxt > prev ? nxt - prev : null;
  };
  const growth: UsageTokenBreakdown = {
    inputUncached: delta(previous.inputUncached, next.inputUncached),
    cacheRead: delta(previous.cacheRead, next.cacheRead),
    cacheWrite: delta(previous.cacheWrite, next.cacheWrite),
    output: delta(previous.output, next.output),
    reasoningOutput: null,
    total: delta(previous.total, next.total),
  };
  const grew =
    growth.inputUncached !== null ||
    growth.cacheRead !== null ||
    growth.cacheWrite !== null ||
    growth.output !== null ||
    growth.total !== null;
  // Identical replay, or any shrinkage (must not happen): nothing to add.
  return grew ? growth : null;
}

// === Codex ===

export interface CodexUsageAccumulatorInput {
  /**
   * Trusted baseline: the thread's cumulative counters BEFORE this invocation
   * began. Zero counters for a fresh thread; a persisted checkpoint for a
   * resumed thread; `baselineKnown: false` when no trustworthy baseline exists.
   */
  baseline?: CodexTokenUsageCounters | null;
  baselineKnown: boolean;
  nativeThreadId?: string;
}

function zeroCounters(): CodexTokenUsageCounters {
  return {
    totalTokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
}

/** OpenAI convention (cached ⊆ input) → host disjoint classification. */
export function countersToBreakdown(counters: CodexTokenUsageCounters): UsageTokenBreakdown {
  const inputTotal = counters.inputTokens || 0;
  const cacheRead = Math.min(counters.cachedInputTokens || 0, inputTotal);
  const output = counters.outputTokens || 0;
  return {
    inputUncached: inputTotal - cacheRead,
    cacheRead,
    cacheWrite: counters.cacheWriteInputTokens || 0,
    output,
    reasoningOutput: Math.min(counters.reasoningOutputTokens || 0, output),
    total: counters.totalTokens || 0,
  };
}

function subtractCounters(
  a: CodexTokenUsageCounters,
  b: CodexTokenUsageCounters
): CodexTokenUsageCounters {
  return {
    totalTokens: a.totalTokens - b.totalTokens,
    inputTokens: a.inputTokens - b.inputTokens,
    cachedInputTokens: a.cachedInputTokens - b.cachedInputTokens,
    cacheWriteInputTokens: a.cacheWriteInputTokens - b.cacheWriteInputTokens,
    outputTokens: a.outputTokens - b.outputTokens,
    reasoningOutputTokens: a.reasoningOutputTokens - b.reasoningOutputTokens,
  };
}

function isZeroCounters(counters: CodexTokenUsageCounters): boolean {
  return Object.values(counters).every(value => value === 0);
}

function countersEqual(a: CodexTokenUsageCounters, b: CodexTokenUsageCounters): boolean {
  return (
    a.totalTokens === b.totalTokens &&
    a.inputTokens === b.inputTokens &&
    a.cachedInputTokens === b.cachedInputTokens &&
    a.cacheWriteInputTokens === b.cacheWriteInputTokens &&
    a.outputTokens === b.outputTokens &&
    a.reasoningOutputTokens === b.reasoningOutputTokens
  );
}

function countersAtLeast(a: CodexTokenUsageCounters, b: CodexTokenUsageCounters): boolean {
  return (
    a.totalTokens >= b.totalTokens &&
    a.inputTokens >= b.inputTokens &&
    a.cachedInputTokens >= b.cachedInputTokens &&
    a.cacheWriteInputTokens >= b.cacheWriteInputTokens &&
    a.outputTokens >= b.outputTokens &&
    a.reasoningOutputTokens >= b.reasoningOutputTokens
  );
}

function addCounters(
  a: CodexTokenUsageCounters,
  b: CodexTokenUsageCounters
): CodexTokenUsageCounters {
  return {
    totalTokens: a.totalTokens + b.totalTokens,
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheWriteInputTokens: a.cacheWriteInputTokens + b.cacheWriteInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningOutputTokens: a.reasoningOutputTokens + b.reasoningOutputTokens,
  };
}

/**
 * Codex accumulator (design §5.2).
 *
 * `invocation usage = 结束累计 total − 本次开始前 baseline`, computed per
 * category from the thread-cumulative `total` breakdown. The `last`
 * breakdown is NEVER accumulated (single-request diagnostics only).
 *
 * Repeated notifications with identical counters are duplicates (dropped).
 * A regression (total below the last seen) is a counter reset: keep the
 * already-attributed usage and mark the invocation partial. Without a native
 * epoch id further increments cannot be separated from replay — the gap is never clamped away to fake completeness.
 *
 * Without a trusted baseline, only the deltas BETWEEN this invocation's own
 * notifications are attributable; the first request cannot be separated from
 * prior thread activity, so with nothing attributable the snapshot is
 * missing, and with partial attribution it stays partial
 * (`missing_baseline`).
 */
export class CodexUsageAccumulator {
  private revision = 0;
  private baseline: CodexTokenUsageCounters;
  private baselineUsable: boolean;
  private lastSeen: CodexTokenUsageCounters | null = null;
  private attributed: CodexTokenUsageCounters = zeroCounters();
  private readonly reasons: string[] = [];
  private sawAnyNotification = false;
  private readonly nativeThreadId: string | undefined;

  constructor(input: CodexUsageAccumulatorInput) {
    this.baseline = input.baseline ?? zeroCounters();
    this.baselineUsable = input.baselineKnown;
    if (!input.baselineKnown) this.reasons.push('missing_baseline');
    this.nativeThreadId = input.nativeThreadId;
  }

  /**
   * Feed one `thread/tokenUsage/updated` cumulative `total`. Returns the new
   * cumulative snapshot, or null for duplicate notifications.
   */
  onNotification(total: CodexTokenUsageCounters): RuntimeUsageSnapshot | null {
    this.sawAnyNotification = true;
    if (this.lastSeen && countersEqual(total, this.lastSeen)) return null;
    // Without a native epoch id, a rewind could be a stale notification.
    // Retain the proven prefix and stop attribution instead of counting it
    // again when the old high watermark is replayed.
    if (this.reasons.includes('counter_reset')) return null;

    if (this.lastSeen && !countersAtLeast(total, this.lastSeen)) {
      // Counter regression: the thread accumulator was reset or rewound.
      // Everything already attributed to this invocation stays attributed;
      // the unexplainable gap keeps the invocation partial instead of being
      // clamped away.
      if (!this.reasons.includes('counter_reset')) this.reasons.push('counter_reset');
      this.baselineUsable = false;
      this.baseline = total;
      this.lastSeen = total;
      this.revision += 1;
      return this.snapshot(false);
    }

    if (this.lastSeen) {
      // Subsequent notification: the delta since the previous notification
      // happened inside this invocation and is attributable either way.
      this.attributed = addCounters(this.attributed, subtractCounters(total, this.lastSeen));
    } else if (this.baselineUsable) {
      // First notification with a trusted baseline: the diff against the
      // pre-invocation counters is the provable usage. A baseline that is
      // suddenly AHEAD of the notification is a rewind — treat as a reset
      // instead of attributing negative tokens.
      if (!countersAtLeast(total, this.baseline)) {
        if (!this.reasons.includes('counter_reset')) this.reasons.push('counter_reset');
        this.baselineUsable = false;
      } else {
        this.attributed = addCounters(this.attributed, subtractCounters(total, this.baseline));
      }
    }
    this.lastSeen = total;
    this.revision += 1;
    return this.snapshot(false);
  }

  /** Final snapshot; carries the checkpoint for the next resumed invocation. */
  finalize(input: { interrupted?: boolean } = {}): RuntimeUsageSnapshot {
    this.revision += 1;
    if (input.interrupted && !this.reasons.includes('interrupted')) {
      this.reasons.push('interrupted');
    }
    return this.snapshot(true);
  }

  private snapshot(final: boolean): RuntimeUsageSnapshot {
    const tokens = this.currentBreakdown();
    const reason = this.reasons.length > 0 ? this.reasons.join('+') : undefined;
    if (!breakdownHasKnownValue(tokens)) {
      return missingUsageSnapshot(
        'codex_thread_delta',
        this.revision,
        final,
        reason ?? 'no_usage_reported'
      );
    }
    const checkpoint: RuntimeUsageSnapshot['checkpoint'] = this.lastSeen
      ? {
          schemaVersion: USAGE_SNAPSHOT_SCHEMA_VERSION,
          ...(this.nativeThreadId ? { nativeThreadId: this.nativeThreadId } : {}),
          cumulative: this.lastSeen,
          capturedAt: Date.now(),
        }
      : undefined;
    return buildInvocationSnapshot({
      revision: this.revision,
      final,
      status: final ? this.status() : 'partial',
      reason,
      tokens,
      sourceKind: 'codex_thread_delta',
      includesSubagents: 'unknown',
      checkpoint,
    });
  }

  private currentBreakdown(): UsageTokenBreakdown {
    if (
      isZeroCounters(this.attributed) &&
      (!this.sawAnyNotification || !this.baselineUsable || this.reasons.length > 0)
    )
      return emptyBreakdown();
    return countersToBreakdown(this.attributed);
  }

  private status(): 'complete' | 'partial' {
    return this.baselineUsable && this.reasons.length === 0 ? 'complete' : 'partial';
  }
}

// === Cursor ===

export interface CursorResultUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  totalTokens?: number | null;
}

/**
 * Cursor accumulator. Both transports only expose a terminal usage value;
 * anything less downgrades to missing — a reliable missing state beats an
 * unexplainable number (design §5.3). `usage_update` mid-turn events stay
 * ignored: their protocol meaning (context occupancy vs consumption) is
 * unverified, so they must never be counted as consumed tokens.
 */
export class CursorUsageAccumulator {
  private revision = 0;

  onResult(usage: CursorResultUsage | undefined): RuntimeUsageSnapshot {
    this.revision += 1;
    if (!usage) {
      return missingUsageSnapshot('cursor_result', this.revision, true, 'not_reported');
    }
    const inputUncached = usage.inputTokens ?? null;
    const cacheRead = usage.cacheReadTokens ?? null;
    const cacheWrite = usage.cacheWriteTokens ?? null;
    const output = usage.outputTokens ?? null;
    const disjoint = [inputUncached, cacheRead, cacheWrite, output].every(v => v !== null);
    const total =
      usage.totalTokens ??
      (disjoint
        ? (inputUncached as number) +
          (cacheRead as number) +
          (cacheWrite as number) +
          (output as number)
        : null);
    if (
      total === null &&
      inputUncached === null &&
      output === null &&
      cacheRead === null &&
      cacheWrite === null
    ) {
      return missingUsageSnapshot('cursor_result', this.revision, true, 'not_reported');
    }
    return buildInvocationSnapshot({
      revision: this.revision,
      final: true,
      // Turn-aggregate counters over every LLM call the turn made; the range
      // is credible only when the disjoint classification (and thus the
      // derived total) is complete.
      status: disjoint && total !== null ? 'complete' : 'partial',
      reason: disjoint && total !== null ? undefined : 'incomplete_classification',
      tokens: {
        inputUncached,
        cacheRead,
        cacheWrite,
        output,
        reasoningOutput: null,
        total,
      },
      sourceKind: 'cursor_result',
      includesSubagents: 'unknown',
    });
  }

  /** Prompt ended without any terminal usage evidence (cancel/crash/absent field). */
  onInterrupted(reason = 'interrupted'): RuntimeUsageSnapshot {
    this.revision += 1;
    return missingUsageSnapshot('cursor_result', this.revision, true, reason);
  }
}
