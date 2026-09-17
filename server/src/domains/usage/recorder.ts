import type { Database } from 'better-sqlite3';
import type { UsageInfo } from '@zclaudia/shared/core/message';
import type {
  RuntimeUsageSnapshot,
  UsageTokenBreakdown,
} from '@zclaudia/shared/core/runtime-usage';
import { parseRuntimeUsageSnapshot } from '@zclaudia/shared/core/runtime-usage';
import type { RuntimeUsageIdentity } from './types.js';
import { RuntimeUsageRepository } from './repository.js';

/**
 * Usage recorder (design §4): validates provider snapshots and writes the
 * ledger transactionally; owns the dispatch/terminal lifecycle entrances.
 *
 * The recorder never trusts event payloads it did not validate, never
 * changes a usage status based on the execution outcome, and never lets a
 * snapshot revision move backwards.
 */
export class UsageRecorder {
  readonly repository: RuntimeUsageRepository;

  constructor(db: Database) {
    this.repository = new RuntimeUsageRepository(db);
  }

  /**
   * Write the dispatching record BEFORE the runtime is invoked and pin the
   * invocation on the run. Every dispatch attempt gets a fresh id, so host
   * retries each account separately while event replays never create rows.
   *
   * Best-effort by contract: a ledger failure (missing table in a test or
   * legacy database, disk error) must never break the run itself.
   */
  beginInvocation(identity: RuntimeUsageIdentity): string {
    try {
      this.repository.startInvocation(identity);
    } catch (error) {
      console.warn(
        '[UsageRecorder] beginInvocation failed (ledger unavailable?):',
        error instanceof Error ? error.message : error
      );
    }
    return identity.invocationId;
  }

  markRunning(invocationId: string): void {
    try {
      this.repository.markRunning(invocationId);
    } catch (error) {
      console.warn(
        '[UsageRecorder] markRunning failed:',
        error instanceof Error ? error.message : error
      );
    }
  }

  /**
   * Single settlement entrance for completed / failed / cancelled runs.
   * `compatUsage` is the terminal `result` usage of runtimes that did not
   * emit snapshots (old plugins): recorded as a low-confidence partial so
   * known consumption is not lost, never auto-promoted to complete.
   */
  settleInvocation(input: {
    invocationId: string;
    executionState: 'completed' | 'failed' | 'cancelled';
    compatUsage?: UsageInfo;
    reason?: string;
  }): void {
    try {
      const settlementApplied = this.repository.settle({
        invocationId: input.invocationId,
        executionState: input.executionState,
        endedAt: Date.now(),
      });
      if (!settlementApplied) return; // already settled (retry handoff etc.)
      if (input.compatUsage && !this.repository.hasRecordedUsage(input.invocationId)) {
        this.repository.applySnapshot(
          input.invocationId,
          compatSnapshotFromUsageInfo(input.compatUsage, input.reason)
        );
      }
    } catch (error) {
      console.warn(
        '[UsageRecorder] settleInvocation failed:',
        error instanceof Error ? error.message : error
      );
    }
  }

  /** Settle a dispatch that provably never started the runtime (coverage-excluded). */
  settleNotStarted(invocationId: string): void {
    try {
      this.repository.markNotStarted(invocationId);
    } catch (error) {
      console.warn(
        '[UsageRecorder] settleNotStarted failed:',
        error instanceof Error ? error.message : error
      );
    }
  }

  /**
   * Validate + persist one plugin snapshot (usage.updated domain events).
   * Invalid shapes are dropped rather than normalized into the ledger.
   */
  applySnapshotEvent(invocationId: string, raw: unknown): boolean {
    const snapshot = parseRuntimeUsageSnapshot(raw);
    if (!snapshot) return false;
    try {
      return this.repository.applySnapshot(invocationId, snapshot);
    } catch (error) {
      console.warn(
        '[UsageRecorder] applySnapshot failed:',
        error instanceof Error ? error.message : error
      );
      return false;
    }
  }

  /**
   * Late terminal correction (design §6.7): after settlement a newer
   * revision from the same execution source still replaces the stored
   * snapshot. Re-dispatch never happens here.
   */
  applyLateCorrection(invocationId: string, raw: unknown): boolean {
    return this.applySnapshotEvent(invocationId, raw);
  }
}

// Per-process recorder cache — the server holds one database instance.
const recorderCache = new WeakMap<Database, UsageRecorder>();

export function getUsageRecorder(db: Database): UsageRecorder {
  let recorder = recorderCache.get(db);
  if (!recorder) {
    recorder = new UsageRecorder(db);
    recorderCache.set(db, recorder);
  }
  return recorder;
}

/**
 * Terminal `result` usage arriving without a snapshot stream (old plugins /
 * not-yet-upgraded runtimes). Low confidence by contract: the accounting
 * range of a runtime that never explained its metering cannot be complete.
 */
export function compatSnapshotFromUsageInfo(
  usage: UsageInfo,
  reason?: string
): RuntimeUsageSnapshot & { revision: number } {
  const tokens: UsageTokenBreakdown = {
    inputUncached: numberOrNull(usage.input),
    cacheRead: numberOrNull(usage.cacheRead),
    cacheWrite: numberOrNull(usage.cacheWrite),
    output: numberOrNull(usage.output),
    reasoningOutput: null,
    total: numberOrNull(usage.totalTokens),
  };
  const hasAny =
    tokens.total !== null ||
    tokens.inputUncached !== null ||
    tokens.cacheRead !== null ||
    tokens.cacheWrite !== null ||
    tokens.output !== null;
  if (!hasAny) {
    return {
      schemaVersion: 1,
      revision: 1,
      final: true,
      status: 'missing',
      reason: reason ?? 'legacy_terminal_usage_unavailable',
      tokens: {
        inputUncached: null,
        cacheRead: null,
        cacheWrite: null,
        output: null,
        reasoningOutput: null,
        total: null,
      },
      models: [],
      source: {
        kind: 'legacy_terminal_usage',
        scope: 'invocation',
        includesSubagents: 'unknown',
        ruleVersion: 1,
      },
    };
  }
  return {
    schemaVersion: 1,
    revision: 1,
    final: true,
    status: 'partial',
    reason: reason ?? 'legacy_terminal_usage',
    tokens,
    models: [],
    source: {
      kind: 'legacy_terminal_usage',
      scope: 'invocation',
      includesSubagents: 'unknown',
      ruleVersion: 1,
    },
  };
}

function numberOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
