import { describe, expect, it } from 'vitest';

import { WebFetchCache } from '../web-fetch-cache.js';

describe('WebFetchCache', () => {
  it('expires entries after the TTL', () => {
    let now = 0;
    const cache = new WebFetchCache<string>({ ttlMs: 100, maxBytes: 1_000 }, () => now);
    cache.set('a', 'A', 1);
    expect(cache.get('a')).toBe('A');
    now = 101;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('evicts least-recently-used entries past the byte budget', () => {
    const cache = new WebFetchCache<string>({ ttlMs: 1_000, maxBytes: 10 });
    cache.set('a', 'A', 4);
    cache.set('b', 'B', 4);
    expect(cache.get('a')).toBe('A'); // refresh a
    cache.set('c', 'C', 4); // 12 > 10 → evict oldest (b)
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('A');
    expect(cache.get('c')).toBe('C');
    expect(cache.bytes).toBe(8);
  });

  it('ignores entries larger than the whole budget', () => {
    const cache = new WebFetchCache<string>({ ttlMs: 1_000, maxBytes: 10 });
    cache.set('big', 'X', 11);
    expect(cache.size).toBe(0);
  });
});
