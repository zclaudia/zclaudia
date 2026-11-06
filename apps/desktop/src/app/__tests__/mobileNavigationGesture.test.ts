import { describe, expect, it } from 'vitest';
import { navigationAxis, navigationRelease } from '../mobileNavigationGesture';

describe('navigation movement intent', () => {
  it('keeps taps pending, takes clear horizontal motion and yields diagonal/vertical motion', () => {
    expect(navigationAxis(7, 0)).toBe('pending');
    expect(navigationAxis(9, 2)).toBe('horizontal');
    expect(navigationAxis(2, 10)).toBe('native');
    expect(navigationAxis(12, 12)).toBe('native');
  });
  it('samples speed in px/s and zeros a stopped release after 80ms', () => {
    const samples = [{ x: 0, time: 0 }, { x: 60, time: 60 }];
    expect(navigationRelease([...samples], 60, 70)).toEqual({ velocityPxPerSecond: 1000, releaseRunDistancePx: 60 });
    expect(navigationRelease([...samples], 60, 140)).toEqual({ velocityPxPerSecond: 0, releaseRunDistancePx: 0 });
  });
  it('uses an intentional reverse run rather than the whole gesture average', () => {
    const samples = [{ x: 0, time: 0 }, { x: 100, time: 30 }, { x: 70, time: 50 }, { x: 40, time: 70 }];
    expect(navigationRelease(samples, 40, 75)).toEqual({ velocityPxPerSecond: -1500, releaseRunDistancePx: -60 });
  });
  it('ignores a one-pixel reverse jitter and bounds coalesced sample spikes', () => {
    expect(navigationRelease([{ x: 0, time: 0 }, { x: 60, time: 40 }, { x: 59, time: 45 }], 59, 45).velocityPxPerSecond).toBeGreaterThan(550);
    expect(navigationRelease([{ x: 0, time: 0 }], 100, 0.1).velocityPxPerSecond).toBe(5000);
  });
});
