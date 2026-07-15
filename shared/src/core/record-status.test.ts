import { describe, it, expect } from 'vitest';
import { recordChip, type RecordStatus } from './record-status.js';

const ready: RecordStatus = { completeness: 'ready', availability: { usable: true } };

describe('recordChip', () => {
  it('returns "ready" when complete, usable, and not disabled', () => {
    expect(recordChip(ready)).toBe('ready');
  });

  it('prefers "draft" over every other facet', () => {
    expect(
      recordChip({
        completeness: 'draft',
        availability: { usable: false, reason: 'needs_auth' },
        disabled: true,
      })
    ).toBe('draft');
  });

  it('returns "unavailable" for a complete record whose dependency failed (over disabled/ready)', () => {
    expect(
      recordChip({
        completeness: 'ready',
        availability: { usable: false, reason: 'connect_failed' },
        disabled: true,
      })
    ).toBe('unavailable');
  });

  it('returns "disabled" for a complete, usable, but disabled record', () => {
    expect(recordChip({ ...ready, disabled: true })).toBe('disabled');
  });
});
