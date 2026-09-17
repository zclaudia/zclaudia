/**
 * Plugin-side runtime usage contract (design:
 * docs/specs/2026-09-16-runtime-token-usage-design.md §4).
 *
 * Agent-common must stay inside the public plugin boundary (no
 * @zclaudia/shared imports), so these declarations are the plugin-side twin
 * of the host contract in shared/src/core/runtime-usage.ts. They must remain
 * structurally identical; the server's snapshot validator plus the
 * agent-common fixture round-trip test are the drift guard.
 *
 * The schema-version constant lives here too — a value import from shared
 * would drag workspace code into plugin bundles.
 */
import type { ProviderRuntimeEvent } from '@zclaudia/plugin-sdk/providers';

/** Version of the usage snapshot contract. Bump on any breaking field change. */
export const USAGE_SNAPSHOT_SCHEMA_VERSION = 1;

/** Metering rules version interpreted by the accumulators in this module. */
export const USAGE_RULE_VERSION = 1;

/**
 * Token classification. All values are non-negative safe integers; `null`
 * means "unknown". 0 must always come from an observed zero, never as a
 * placeholder for missing data. Complete classification satisfies
 * `total = inputUncached + cacheRead + cacheWrite + output`.
 */
export interface UsageTokenBreakdown {
  inputUncached: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  output: number | null;
  /** Output subset — display detail only, never added back into totals. */
  reasoningOutput: number | null;
  total: number | null;
}

export type RuntimeUsageDataStatus = 'complete' | 'partial' | 'missing';

/** Per-model allocation inside one invocation. Allocations are mutually exclusive. */
export interface UsageModelAllocation {
  /** Runtime-reported actual model id; null = Unknown model bucket. */
  modelId: string | null;
  tokens: UsageTokenBreakdown;
}

/** Persisted counter state used to baseline the next resumed invocation. */
export interface UsageSourceCheckpoint {
  schemaVersion: 1;
  nativeThreadId?: string;
  counterEpoch?: number;
  cumulative?: CodexTokenUsageCounters | null;
  capturedAt: number;
}

/** OpenAI-convention Codex counters (`cachedInputTokens` ⊆ `inputTokens`). */
export interface CodexTokenUsageCounters {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

/**
 * One cumulative usage snapshot for an invocation. The adapter emits the
 * CURRENT accumulated state; the host REPLACES stored snapshots by
 * (invocationId, revision) rather than summing successive events.
 */
export interface RuntimeUsageSnapshot {
  schemaVersion: typeof USAGE_SNAPSHOT_SCHEMA_VERSION;
  /** Strictly increasing within one invocation. */
  revision: number;
  /** True once the usage snapshot is settled — does NOT imply task success. */
  final: boolean;
  status: RuntimeUsageDataStatus;
  /** Machine-readable downgrade cause, e.g. `missing_baseline` / `interrupted`. */
  reason?: string;
  /** Audit summary when source total and classification/allocation conflict. */
  discrepancy?: string;
  tokens: UsageTokenBreakdown;
  models: UsageModelAllocation[];
  source: {
    kind: string;
    scope: 'invocation';
    includesSubagents: 'yes' | 'no' | 'unknown';
    ruleVersion: number;
  };
  /**
   * Restricted checkpoint: counters, native ids and time ONLY — never
   * prompts, replies, tool input or secrets. Host-side storage; never
   * forwarded to clients.
   */
  checkpoint?: UsageSourceCheckpoint;
}

/** Plugin → host usage event (bridged onto the provider event channel). */
export interface ProviderUsageUpdatedEvent {
  type: 'provider_usage_updated';
  snapshot: RuntimeUsageSnapshot;
}

/**
 * Bridge a usage snapshot onto the plugin→host event channel. The published
 * plugin-sdk (0.4.0) union does not carry the usage event yet — plugins cast
 * at this single site and the host accepts the variant through
 * @zclaudia/shared/providers. Drop the cast once the SDK ships the variant.
 */
export function providerUsageUpdatedEvent(snapshot: RuntimeUsageSnapshot): ProviderRuntimeEvent {
  return { type: 'provider_usage_updated', snapshot } as unknown as ProviderRuntimeEvent;
}

export function emptyBreakdown(): UsageTokenBreakdown {
  return {
    inputUncached: null,
    cacheRead: null,
    cacheWrite: null,
    output: null,
    reasoningOutput: null,
    total: null,
  };
}

/** Sum known values only; a null partner keeps the known one (null = unknown). */
export function addKnownBreakdowns(
  a: UsageTokenBreakdown,
  b: UsageTokenBreakdown
): UsageTokenBreakdown {
  const add = (x: number | null, y: number | null): number | null =>
    x === null && y === null ? null : (x ?? 0) + (y ?? 0);
  return {
    inputUncached: add(a.inputUncached, b.inputUncached),
    cacheRead: add(a.cacheRead, b.cacheRead),
    cacheWrite: add(a.cacheWrite, b.cacheWrite),
    output: add(a.output, b.output),
    reasoningOutput: add(a.reasoningOutput, b.reasoningOutput),
    total: add(a.total, b.total),
  };
}

export function breakdownHasKnownValue(breakdown: UsageTokenBreakdown): boolean {
  return (
    breakdown.total !== null ||
    breakdown.inputUncached !== null ||
    breakdown.cacheRead !== null ||
    breakdown.cacheWrite !== null ||
    breakdown.output !== null ||
    breakdown.reasoningOutput !== null
  );
}

export interface InvocationSnapshotInput {
  revision: number;
  final: boolean;
  status: RuntimeUsageDataStatus;
  reason?: string;
  discrepancy?: string;
  tokens: UsageTokenBreakdown;
  models?: UsageModelAllocation[];
  sourceKind: string;
  includesSubagents?: 'yes' | 'no' | 'unknown';
  checkpoint?: RuntimeUsageSnapshot['checkpoint'];
}

export function buildInvocationSnapshot(input: InvocationSnapshotInput): RuntimeUsageSnapshot {
  return {
    schemaVersion: USAGE_SNAPSHOT_SCHEMA_VERSION,
    revision: input.revision,
    final: input.final,
    status: input.status,
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.discrepancy ? { discrepancy: input.discrepancy } : {}),
    tokens: input.tokens,
    models: input.models ?? [],
    source: {
      kind: input.sourceKind,
      scope: 'invocation',
      includesSubagents: input.includesSubagents ?? 'unknown',
      ruleVersion: USAGE_RULE_VERSION,
    },
    ...(input.checkpoint ? { checkpoint: input.checkpoint } : {}),
  };
}

/** Missing-usage snapshot for an invocation that produced no token evidence. */
export function missingUsageSnapshot(
  sourceKind: string,
  revision: number,
  final: boolean,
  reason: string
): RuntimeUsageSnapshot {
  return buildInvocationSnapshot({
    revision,
    final,
    status: 'missing',
    reason,
    tokens: emptyBreakdown(),
    sourceKind,
  });
}
