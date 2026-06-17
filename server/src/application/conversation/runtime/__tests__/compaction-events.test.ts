import { describe, it, expect } from 'vitest';
import { compactionDomainEventFor } from '../compaction-events.js';

describe('compactionDomainEventFor', () => {
  it('maps compacted outcome to compaction.completed domain event', () => {
    const event = compactionDomainEventFor({
      outcome: { outcome: 'compacted', compacted: true, compactionId: 'c1', tokensBefore: 100 },
      providerType: 'zclaudia',
      runId: 'r1',
      seq: 7,
      sessionId: 's1',
    });

    expect(event).toEqual(expect.objectContaining({
      type: 'compaction.completed',
      runId: 'r1',
      sessionId: 's1',
      providerType: 'zclaudia',
      seq: 7,
      source: 'runtime',
      payload: {
        compactionId: 'c1',
        tokensBefore: 100,
      },
    }));
  });

  it('maps failed outcome to compaction.failed domain event with breaker fields', () => {
    const event = compactionDomainEventFor({
      outcome: {
        outcome: 'failed',
        compacted: false,
        reason: 'error: x',
        breaker: { consecutiveFailures: 3, breakerOpen: true, nextRetryAtMs: 999 },
      },
      runId: 'r1',
      seq: 8,
      sessionId: 's1',
    });

    expect(event).toEqual(expect.objectContaining({
      type: 'compaction.failed',
      runId: 'r1',
      sessionId: 's1',
      seq: 8,
      source: 'runtime',
      payload: {
        reason: 'error: x',
        breakerOpen: true,
        nextRetryAtMs: 999,
      },
    }));
  });

  it('maps skipped and aborted outcomes to null', () => {
    expect(compactionDomainEventFor({
      outcome: { outcome: 'skipped', compacted: false, reason: 'circuit_open' },
      runId: 'r1',
      seq: 1,
      sessionId: 's1',
    })).toBeNull();
    expect(compactionDomainEventFor({
      outcome: { outcome: 'aborted', compacted: false, reason: 'aborted: x' },
      runId: 'r1',
      seq: 1,
      sessionId: 's1',
    })).toBeNull();
  });
});
