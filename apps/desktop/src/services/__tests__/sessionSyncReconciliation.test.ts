import { describe, expect, it } from 'vitest';
import { findDeletedSessionIds, planDeltaSessionEvents } from '../sessionSyncReconciliation';

describe('sessionSyncReconciliation', () => {
  it('finds local sessions missing from a full server snapshot', () => {
    expect(
      findDeletedSessionIds(
        [
          { id: 'kept', updatedAt: 1 },
          { id: 'deleted', updatedAt: 1 },
        ],
        [{ id: 'kept', updatedAt: 2 }]
      )
    ).toEqual(['deleted']);
  });

  it('plans created and newer updated events for delta sessions', () => {
    expect(
      planDeltaSessionEvents(
        [
          { id: 'existing-newer', updatedAt: 10 },
          { id: 'existing-older', updatedAt: 1 },
          { id: 'existing-same', updatedAt: 3 },
        ],
        [
          { id: 'created', updatedAt: 1 },
          { id: 'existing-newer', updatedAt: 11 },
          { id: 'existing-older', updatedAt: 1 },
          { id: 'existing-same', updatedAt: 3 },
        ]
      )
    ).toEqual([
      { eventType: 'created', session: { id: 'created', updatedAt: 1 } },
      { eventType: 'updated', session: { id: 'existing-newer', updatedAt: 11 } },
    ]);
  });
});
