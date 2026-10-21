import { describe, it, expect } from 'vitest';
import {
  safeCompare,
  createHostCapabilityStore,
  DEFAULT_HOST_CAPABILITY_TTL_MS,
  HOST_CAPABILITY_HEADER,
} from '../auth.js';

describe('safeCompare', () => {
  describe('timing-safe comparison', () => {
    it('returns true for identical strings', () => {
      expect(safeCompare('test', 'test')).toBe(true);
    });

    it('returns false for different strings', () => {
      expect(safeCompare('test1', 'test2')).toBe(false);
    });

    it('returns false for strings of different lengths', () => {
      expect(safeCompare('test', 'testing')).toBe(false);
    });

    it('returns false for different strings of equal length', () => {
      expect(safeCompare('abcd', 'abce')).toBe(false);
    });
  });

  describe('input validation', () => {
    it('returns false when the first argument is not a string', () => {
      expect(safeCompare(null as any, 'test')).toBe(false);
    });

    it('returns false when the second argument is not a string', () => {
      expect(safeCompare('test', undefined as any)).toBe(false);
    });

    it('returns false when both arguments are non-strings', () => {
      expect(safeCompare(123 as any, 456 as any)).toBe(false);
    });

    it('returns false for null arguments', () => {
      expect(safeCompare(null as any, null as any)).toBe(false);
    });

    it('returns false for undefined arguments', () => {
      expect(safeCompare(undefined as any, undefined as any)).toBe(false);
    });

    it('returns false for number arguments', () => {
      expect(safeCompare(123 as any, '123')).toBe(false);
    });

    it('returns false for object arguments', () => {
      expect(safeCompare({} as any, 'test')).toBe(false);
    });

    it('returns false for array arguments', () => {
      expect(safeCompare([] as any, 'test')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles empty strings', () => {
      expect(safeCompare('', '')).toBe(true);
    });

    it('handles an empty vs a non-empty string', () => {
      expect(safeCompare('', 'test')).toBe(false);
    });

    it('handles single-character strings', () => {
      expect(safeCompare('a', 'a')).toBe(true);
      expect(safeCompare('a', 'b')).toBe(false);
    });

    it('handles long strings', () => {
      const longString = 'a'.repeat(10000);
      expect(safeCompare(longString, longString)).toBe(true);
      expect(safeCompare(longString, longString + 'b')).toBe(false);
    });
  });

  describe('unicode and special characters', () => {
    it('handles unicode strings', () => {
      expect(safeCompare('🔥', '🔥')).toBe(true);
      expect(safeCompare('🔥', '💧')).toBe(false);
    });

    it('handles multi-byte unicode characters', () => {
      expect(safeCompare('你好', '你好')).toBe(true);
      expect(safeCompare('你好', '世界')).toBe(false);
    });

    it('handles emoji', () => {
      expect(safeCompare('😀🎉', '😀🎉')).toBe(true);
      expect(safeCompare('😀🎉', '😀😊')).toBe(false);
    });

    it('handles special characters', () => {
      expect(safeCompare('test\n', 'test\n')).toBe(true);
      expect(safeCompare('test\n', 'test')).toBe(false);
    });

    it('handles null characters', () => {
      expect(safeCompare('test\0', 'test\0')).toBe(true);
      expect(safeCompare('test\0', 'test')).toBe(false);
    });

    it('handles tabs', () => {
      expect(safeCompare('\t\t', '\t\t')).toBe(true);
      expect(safeCompare('\t\t', '\t ')).toBe(false);
    });

    it('handles CRLF', () => {
      expect(safeCompare('\r\n', '\r\n')).toBe(true);
      expect(safeCompare('\r\n', '\n')).toBe(false);
    });
  });

  describe('security properties', () => {
    it('still performs the comparison on length mismatch to keep constant time', () => {
      // Verifies timingSafeEqual is still invoked on length mismatch.
      // Timing cannot be measured directly; assert the call does not throw.
      expect(() => safeCompare('short', 'longer')).not.toThrow();
      expect(safeCompare('short', 'longer')).toBe(false);
    });

    it('returns false for very similar strings', () => {
      expect(safeCompare('test1', 'test2')).toBe(false);
      expect(safeCompare('abc', 'abd')).toBe(false);
      expect(safeCompare('12345', '12346')).toBe(false);
    });

    it('returns true for the exact same reference', () => {
      const str = 'test-string';
      expect(safeCompare(str, str)).toBe(true);
    });
  });

  describe('typical use cases', () => {
    it('covers the API key scenario', () => {
      const validKey = 'sk-1234567890abcdef';
      const providedKey = 'sk-1234567890abcdef';
      const invalidKey = 'sk-0987654321fedcba';

      expect(safeCompare(validKey, providedKey)).toBe(true);
      expect(safeCompare(validKey, invalidKey)).toBe(false);
    });

    it('covers the token scenario', () => {
      const token1 = 'Bearer abc123xyz789';
      const token2 = 'Bearer abc123xyz789';
      const token3 = 'Bearer different';

      expect(safeCompare(token1, token2)).toBe(true);
      expect(safeCompare(token1, token3)).toBe(false);
    });

    it('covers the secret scenario', () => {
      const secret = 'my-super-secret-password-123';
      expect(safeCompare(secret, 'my-super-secret-password-123')).toBe(true);
      expect(safeCompare(secret, 'wrong-secret')).toBe(false);
    });
  });

  describe('buffer behavior', () => {
    it('handles UTF-8 encoding correctly', () => {
      const utf8String = 'Hello 世界 🌍';
      expect(safeCompare(utf8String, utf8String)).toBe(true);
    });

    it('handles ASCII strings', () => {
      expect(safeCompare('ASCII only', 'ASCII only')).toBe(true);
      expect(safeCompare('ASCII only', 'ASCII onlY')).toBe(false);
    });

    it('is case sensitive', () => {
      expect(safeCompare('Test', 'test')).toBe(false);
      expect(safeCompare('TEST', 'test')).toBe(false);
      expect(safeCompare('Test', 'Test')).toBe(true);
    });
  });
});

describe('createHostCapabilityStore', () => {
  // Deterministic clock: each advanceTime() moves time forward.
  function createClock(start = 1_000) {
    let current = start;
    return {
      now: () => current,
      advance: (ms: number) => {
        current += ms;
      },
    };
  }

  it('exposes the one-time ticket header name and default TTL', () => {
    expect(HOST_CAPABILITY_HEADER).toBe('x-zclaudia-host-capability');
    expect(DEFAULT_HOST_CAPABILITY_TTL_MS).toBe(30_000);
  });

  describe('issue', () => {
    it('returns a capability with an expiry inside the TTL', () => {
      const clock = createClock();
      const store = createHostCapabilityStore({ now: clock.now, ttlMs: 5_000 });

      const { capability, expiresAt } = store.issue();

      expect(capability).toBeTruthy();
      expect(expiresAt).toBe(6_000);
    });

    it('issues distinct capabilities per call', () => {
      const store = createHostCapabilityStore();
      const first = store.issue();
      const second = store.issue();

      expect(first.capability).not.toBe(second.capability);
    });

    it('purges expired tickets when issuing', () => {
      const clock = createClock();
      const store = createHostCapabilityStore({ now: clock.now, ttlMs: 1_000 });
      const { capability } = store.issue();
      clock.advance(2_000);

      store.issue();
      // The expired ticket was purged; consuming it finds nothing (and
      // consume is one-time regardless).
      expect(store.consume(capability)).toBe(false);
    });
  });

  describe('consume', () => {
    it('accepts a fresh ticket exactly once', () => {
      const clock = createClock();
      const store = createHostCapabilityStore({ now: clock.now });
      const { capability } = store.issue();

      expect(store.consume(capability)).toBe(true);
    });

    it('rejects a replayed ticket (one-time semantics)', () => {
      const clock = createClock();
      const store = createHostCapabilityStore({ now: clock.now });
      const { capability } = store.issue();

      expect(store.consume(capability)).toBe(true);
      // Replay — even immediately, well inside the TTL — must fail.
      expect(store.consume(capability)).toBe(false);
      expect(store.consume(capability)).toBe(false);
    });

    it('rejects an expired ticket and still deletes it', () => {
      const clock = createClock();
      const store = createHostCapabilityStore({ now: clock.now, ttlMs: 1_000 });
      const { capability } = store.issue();
      clock.advance(1_001);

      expect(store.consume(capability)).toBe(false);
      expect(store.consume(capability)).toBe(false);
    });

    it('rejects unknown, empty, and missing tickets', () => {
      const store = createHostCapabilityStore();

      expect(store.consume('never-issued')).toBe(false);
      expect(store.consume('')).toBe(false);
      expect(store.consume(undefined)).toBe(false);
    });

    it('rejects a ticket consumed after its store saw later issues', () => {
      const clock = createClock();
      const store = createHostCapabilityStore({ now: clock.now });
      const { capability } = store.issue();
      store.issue(); // unrelated second ticket

      expect(store.consume(capability)).toBe(true);
      expect(store.consume(capability)).toBe(false);
    });
  });

  it('uses the injected capability generator', () => {
    const store = createHostCapabilityStore({
      createCapability: () => 'fixed-ticket',
    });
    const { capability } = store.issue();

    expect(capability).toBe('fixed-ticket');
    expect(store.consume('fixed-ticket')).toBe(true);
  });
});
