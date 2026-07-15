import { describe, it, expect } from 'vitest';
import { recordChip, isRecordRunnable, type RecordStatus } from './record-status.js';

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

describe('isRecordRunnable', () => {
  it('is true only when ready, usable, and not disabled', () => {
    expect(isRecordRunnable({ completeness: 'ready', availability: { usable: true } })).toBe(true);
  });

  it('is false for a draft record', () => {
    expect(isRecordRunnable({ completeness: 'draft', availability: { usable: true } })).toBe(false);
  });

  it('is false for an unavailable record', () => {
    expect(
      isRecordRunnable({ completeness: 'ready', availability: { usable: false, reason: 'no_model' } })
    ).toBe(false);
  });

  it('is false for a disabled record', () => {
    expect(
      isRecordRunnable({ completeness: 'ready', availability: { usable: true }, disabled: true })
    ).toBe(false);
  });
});
