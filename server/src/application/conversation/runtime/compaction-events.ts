import type { CompactionOutcome } from '../compaction/compaction-service.js';
import {
  createRunDomainEvent,
  type RunDomainEvent,
} from './run-domain-events.js';

export function compactionDomainEventFor(input: {
  outcome: CompactionOutcome;
  providerType?: string;
  runId: string;
  seq: number;
  sessionId: string;
}): RunDomainEvent<'compaction.completed'> | RunDomainEvent<'compaction.failed'> | null {
  const { outcome } = input;
  if (outcome.outcome === 'compacted') {
    return createRunDomainEvent({
      type: 'compaction.completed',
      runId: input.runId,
      sessionId: input.sessionId,
      providerType: input.providerType,
      seq: input.seq,
      source: 'runtime',
      payload: {
        compactionId: outcome.compactionId!,
        tokensBefore: outcome.tokensBefore!,
      },
    });
  }
  if (outcome.outcome === 'failed') {
    return createRunDomainEvent({
      type: 'compaction.failed',
      runId: input.runId,
      sessionId: input.sessionId,
      providerType: input.providerType,
      seq: input.seq,
      source: 'runtime',
      payload: {
        reason: outcome.reason ?? 'error: unknown',
        breakerOpen: outcome.breaker?.breakerOpen ?? false,
        nextRetryAtMs: outcome.breaker?.nextRetryAtMs,
      },
    });
  }
  return null;
}
