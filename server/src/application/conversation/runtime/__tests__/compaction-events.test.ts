import { describe, it, expect } from 'vitest';
import { compactionEventFor } from '../compaction-events.js';

describe('compactionEventFor', () => {
  it('maps compacted → compaction_completed', () => {
    const e = compactionEventFor('r1', 's1', { outcome: 'compacted', compacted: true, compactionId: 'c1', tokensBefore: 100 });
    expect(e).toEqual({ type: 'compaction_completed', runId: 'r1', sessionId: 's1', compactionId: 'c1', tokensBefore: 100 });
  });
  it('maps failed → compaction_failed with breaker fields', () => {
    const e = compactionEventFor('r1', 's1', {
      outcome: 'failed', compacted: false, reason: 'error: x',
      breaker: { consecutiveFailures: 3, breakerOpen: true, nextRetryAtMs: 999 },
    });
    expect(e).toEqual({ type: 'compaction_failed', runId: 'r1', sessionId: 's1', reason: 'error: x', breakerOpen: true, nextRetryAtMs: 999 });
  });
  it('maps skipped → null (no wire event)', () => {
    expect(compactionEventFor('r1', 's1', { outcome: 'skipped', compacted: false, reason: 'circuit_open' })).toBeNull();
  });
  it('maps aborted → null', () => {
    expect(compactionEventFor('r1', 's1', { outcome: 'aborted', compacted: false, reason: 'aborted: x' })).toBeNull();
  });
});
