import type {
  UsageSourceCheckpoint,
  UsageTokenBreakdown,
} from '@zclaudia/shared/core/runtime-usage';

/**
 * Execution lifecycle of one ledger record. Independent from usage data
 * quality: a failed invocation can have complete usage, a successful one can
 * have none.
 */
export type RuntimeUsageExecutionState =
  | 'dispatching' // written before the runtime is invoked; start unconfirmed
  | 'running' // provider stream confirmed entered
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted' // restart recovery: the host process died mid-run
  | 'not_started'; // dispatch failed before the runtime could begin

/** Ledger usage status — extends the snapshot statuses with migrated rows. */
export type RuntimeUsageRecordStatus = 'complete' | 'partial' | 'missing' | 'legacy';

/** States whose invocations count toward the coverage denominator. */
export const FINALIZED_EXECUTION_STATES: readonly RuntimeUsageExecutionState[] = [
  'completed',
  'failed',
  'cancelled',
  'interrupted',
];

/** States still consuming — excluded from coverage, reported as in-flight. */
export const IN_FLIGHT_EXECUTION_STATES: readonly RuntimeUsageExecutionState[] = [
  'dispatching',
  'running',
];

/** Identity + environment captured when the host dispatches a runtime call. */
export interface RuntimeUsageIdentity {
  invocationId: string;
  runId: string;
  sessionId: string;
  assistantMessageId?: string;
  parentInvocationId?: string;
  runtimeId: string;
  runtimeVersion?: string;
  transport?: string;
  engineMode?: string;
  adapterVersion?: string;
  requestedModel?: string;
}

export interface InvocationSettlement {
  invocationId: string;
  executionState: Exclude<RuntimeUsageExecutionState, 'dispatching' | 'running'>;
  endedAt?: number;
}

/** Stored per-model allocation inside `model_breakdown_json`. */
export interface ModelAllocationRecord {
  modelId: string | null;
  total: number;
  /** Known output for the model; null when the source did not report it. */
  output: number | null;
  /** Known input side (uncached + cache) for the model; null when not derivable. */
  input: number | null;
}

export interface StoredUsageRecord {
  invocationId: string;
  runId: string;
  sessionId: string;
  assistantMessageId: string | null;
  runtimeId: string;
  executionState: RuntimeUsageExecutionState;
  startedAt: number | null;
  endedAt: number | null;
  /** Attribution timestamp — invocation START, never moved by later updates. */
  accountedAt: number | null;
  updatedAt: number;
  usageStatus: RuntimeUsageRecordStatus;
  reason: string | null;
  revision: number;
  sourceKind: string | null;
  ruleVersion: number | null;
  includesSubagents: string | null;
  tokens: Required<{ [K in keyof UsageTokenBreakdown]: number | null }>;
  contextUsedTokens: number | null;
  modelBreakdown: ModelAllocationRecord[] | null;
  discrepancy: string | null;
  checkpoint: UsageSourceCheckpoint | null;
  legacyMessageId: string | null;
  accountingVersion: number;
}

/** Runtime ids used for buckets without a verified runtime descriptor. */
export const LEGACY_RUNTIME_ID = 'legacy';
