/**
 * Plugin-side helpers for the runtime usage contract (design:
 * docs/specs/2026-09-16-runtime-token-usage-design.md §4).
 *
 * The contract types are canonical in @zclaudia/plugin-sdk/usage and are
 * re-exported here so runtime plugins keep a single import site.
 */
import type { ProviderRuntimeEvent } from '@zclaudia/plugin-sdk/providers';
import {
  RUNTIME_USAGE_SNAPSHOT_SCHEMA_VERSION,
  type RuntimeUsageDataStatus,
  type RuntimeUsageSnapshot,
  type UsageModelAllocation,
  type UsageTokenBreakdown,
} from '@zclaudia/plugin-sdk/usage';

export { RUNTIME_USAGE_SNAPSHOT_SCHEMA_VERSION } from '@zclaudia/plugin-sdk/usage';
export type {
  CodexTokenUsageCounters,
  ProviderUsageUpdatedEvent,
  RuntimeUsageDataStatus,
  RuntimeUsageSnapshot,
  RuntimeUsageSnapshotSource,
  UsageModelAllocation,
  UsageSourceCheckpoint,
  UsageTokenBreakdown,
} from '@zclaudia/plugin-sdk/usage';

/** Metering rules version interpreted by the accumulators in this module. */
export const USAGE_RULE_VERSION = 1;

/** Wrap a usage snapshot as a plugin→host provider event. */
export function providerUsageUpdatedEvent(snapshot: RuntimeUsageSnapshot): ProviderRuntimeEvent {
  return { type: 'provider_usage_updated', snapshot };
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
    schemaVersion: RUNTIME_USAGE_SNAPSHOT_SCHEMA_VERSION,
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
