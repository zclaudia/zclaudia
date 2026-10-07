import { describe, expect, it } from 'vitest';
import {
  addCacheSums,
  cacheHitRate,
  cacheInputTotal,
  cacheShares,
  cacheSumsFromBreakdown,
  emptyCacheSums,
  hasCacheActivity,
  sumCacheSums,
} from './cache-stats';

describe('cacheSumsFromBreakdown', () => {
  it('returns the three input-side buckets when all are known', () => {
    expect(cacheSumsFromBreakdown({ inputUncached: 10, cacheRead: 80, cacheWrite: 5 })).toEqual({
      inputUncached: 10,
      cacheRead: 80,
      cacheWrite: 5,
    });
  });

  it('returns null when any bucket is unknown instead of zero-filling', () => {
    expect(
      cacheSumsFromBreakdown({ inputUncached: 10, cacheRead: null, cacheWrite: 0 })
    ).toBeNull();
    expect(cacheSumsFromBreakdown({ inputUncached: null, cacheRead: 1, cacheWrite: 1 })).toBeNull();
    expect(cacheSumsFromBreakdown({})).toBeNull();
  });
});

describe('cacheHitRate', () => {
  it('is token-weighted read share of the whole input side, writes included', () => {
    expect(cacheHitRate({ inputUncached: 10, cacheRead: 80, cacheWrite: 10 })).toBe(0.8);
  });

  it('is null when nothing was recorded', () => {
    expect(cacheHitRate(emptyCacheSums())).toBeNull();
    expect(cacheHitRate(undefined)).toBeNull();
  });

  it('recomputes from merged sums rather than averaging rates', () => {
    const a = { inputUncached: 0, cacheRead: 90, cacheWrite: 10 }; // 90%
    const b = { inputUncached: 900, cacheRead: 0, cacheWrite: 100 }; // 0%
    expect(cacheHitRate(addCacheSums(a, b))).toBe(90 / 1100);
  });
});

describe('cacheShares', () => {
  it('splits the input side into read / write / uncached fractions', () => {
    expect(cacheShares({ inputUncached: 25, cacheRead: 50, cacheWrite: 25 })).toEqual({
      read: 0.5,
      write: 0.25,
      uncached: 0.25,
    });
  });

  it('is null for an empty input side', () => {
    expect(cacheShares(emptyCacheSums())).toBeNull();
  });
});

describe('hasCacheActivity', () => {
  it('is false when the provider never read or wrote cache', () => {
    expect(hasCacheActivity({ inputUncached: 500, cacheRead: 0, cacheWrite: 0 })).toBe(false);
    expect(hasCacheActivity({ inputUncached: 500, cacheRead: 0, cacheWrite: 1 })).toBe(true);
    expect(hasCacheActivity(undefined)).toBe(false);
  });
});

describe('sumCacheSums', () => {
  it('sums every known entry', () => {
    expect(
      sumCacheSums([
        { inputUncached: 1, cacheRead: 2, cacheWrite: 3 },
        { inputUncached: 4, cacheRead: 5, cacheWrite: 6 },
      ])
    ).toEqual({ inputUncached: 5, cacheRead: 7, cacheWrite: 9 });
  });

  it('is undefined when any source lacks the field (older backend)', () => {
    expect(sumCacheSums([{ inputUncached: 1, cacheRead: 2, cacheWrite: 3 }, undefined])).toBe(
      undefined
    );
  });

  it('is undefined for no sources', () => {
    expect(sumCacheSums([])).toBe(undefined);
  });

  it('cacheInputTotal adds the three buckets', () => {
    expect(cacheInputTotal({ inputUncached: 1, cacheRead: 2, cacheWrite: 3 })).toBe(6);
  });
});
