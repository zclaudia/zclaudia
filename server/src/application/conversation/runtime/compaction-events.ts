import type { CompactionOutcome } from '../compaction/compaction-service.js';
import type { CompactionCompletedEvent, CompactionFailedEvent } from '@zclaudia/shared/wire/messages';

/**
 * Pure mapping from a compaction outcome to its wire event (or null when the
 * outcome should not be surfaced: skipped / aborted). Keeps run-events thin and
 * makes the routing unit-testable without ActiveRun scaffolding.
 */
export function compactionEventFor(
  runId: string,
  sessionId: string,
  outcome: CompactionOutcome,
): CompactionCompletedEvent | CompactionFailedEvent | null {
  if (outcome.outcome === 'compacted') {
    return {
      type: 'compaction_completed',
      runId,
      sessionId,
      compactionId: outcome.compactionId!,
      tokensBefore: outcome.tokensBefore!,
    };
  }
  if (outcome.outcome === 'failed') {
    return {
      type: 'compaction_failed',
      runId,
      sessionId,
      reason: outcome.reason ?? 'error: unknown',
      breakerOpen: outcome.breaker?.breakerOpen ?? false,
      nextRetryAtMs: outcome.breaker?.nextRetryAtMs,
    };
  }
  return null; // skipped / aborted
}
