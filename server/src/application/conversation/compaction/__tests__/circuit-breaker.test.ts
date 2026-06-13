import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveBreaker,
  CompactionCircuitBreaker,
  resolveMaxFailures,
  resolveCooldownMs,
  DEFAULT_MAX_FAILURES,
  DEFAULT_COOLDOWN_MS,
} from '../circuit-breaker.js';

const COOLDOWN = 5 * 60 * 1000;

describe('resolveBreaker (pure)', () => {
  it('allows when no state', () => {
    expect(resolveBreaker(undefined, 1000, 3, COOLDOWN)).toEqual({ action: 'allow', wasHalfOpen: false });
  });

  it('allows while failures below max', () => {
    const s = { consecutiveFailures: 2 };
    expect(resolveBreaker(s, 1000, 3, COOLDOWN)).toEqual({ action: 'allow', wasHalfOpen: false });
  });

  it('skips while open and within cooldown', () => {
    const s = { consecutiveFailures: 3, lastFailureAtMs: 1000, nextRetryAtMs: 1000 + COOLDOWN };
    expect(resolveBreaker(s, 1000 + COOLDOWN - 1, 3, COOLDOWN)).toEqual({
      action: 'skip',
      nextRetryAtMs: 1000 + COOLDOWN,
    });
  });

  it('falls back to lastFailureAtMs + cooldown when nextRetryAtMs missing', () => {
    const s = { consecutiveFailures: 3, lastFailureAtMs: 1000 };
    expect(resolveBreaker(s, 1000 + 10, 3, COOLDOWN)).toEqual({
      action: 'skip',
      nextRetryAtMs: 1000 + COOLDOWN,
    });
  });

  it('allows half-open when cooldown elapsed', () => {
    const s = { consecutiveFailures: 3, lastFailureAtMs: 1000, nextRetryAtMs: 1000 + COOLDOWN };
    expect(resolveBreaker(s, 1000 + COOLDOWN, 3, COOLDOWN)).toEqual({ action: 'allow', wasHalfOpen: true });
  });
});

describe('CompactionCircuitBreaker (stateful)', () => {
  let b: CompactionCircuitBreaker;
  beforeEach(() => { b = new CompactionCircuitBreaker(); });

  it('opens after maxFailures consecutive failures', () => {
    expect(b.evaluate('s', 0).action).toBe('allow');
    b.recordFailure('s', 0);
    b.recordFailure('s', 0);
    expect(b.evaluate('s', 0).action).toBe('allow'); // 2 failures, still closed
    b.recordFailure('s', 0);
    const d = b.evaluate('s', 1);
    expect(d.action).toBe('skip');
  });

  it('recordSuccess clears the breaker', () => {
    b.recordFailure('s', 0); b.recordFailure('s', 0); b.recordFailure('s', 0);
    expect(b.evaluate('s', 1).action).toBe('skip');
    b.recordSuccess('s');
    expect(b.evaluate('s', 1)).toEqual({ action: 'allow', wasHalfOpen: false });
    expect(b.size()).toBe(0);
  });

  it('reset clears the breaker (manual compact)', () => {
    b.recordFailure('s', 0); b.recordFailure('s', 0); b.recordFailure('s', 0);
    b.reset('s');
    expect(b.size()).toBe(0);
  });

  it('evict removes a session entry', () => {
    b.recordFailure('s', 0);
    b.evict('s');
    expect(b.size()).toBe(0);
  });

  it('half-open re-opens immediately on next failure with a fresh cooldown', () => {
    b.recordFailure('s', 0); b.recordFailure('s', 0); b.recordFailure('s', 0);
    // cooldown elapsed → half-open allow
    expect(b.evaluate('s', COOLDOWN).action).toBe('allow');
    // a failure during half-open bumps count and sets a new cooldown from now
    b.recordFailure('s', COOLDOWN);
    const d = b.evaluate('s', COOLDOWN + 1);
    expect(d.action).toBe('skip');
    expect(d.action === 'skip' && d.nextRetryAtMs).toBe(COOLDOWN + COOLDOWN);
  });

  it('soft cap evicts oldest entries by lastFailureAtMs', () => {
    const small = new CompactionCircuitBreaker(2);
    small.recordFailure('a', 10);
    small.recordFailure('b', 20);
    small.recordFailure('c', 30); // exceeds cap → evict oldest ('a')
    expect(small.size()).toBeLessThanOrEqual(2);
    // 'a' (oldest) should be gone
    expect(small.evaluate('a', 100)).toEqual({ action: 'allow', wasHalfOpen: false });
  });
});

describe('env overrides', () => {
  const orig = { ...process.env };
  afterEach(() => { process.env = { ...orig }; });

  it('resolveMaxFailures honors valid positive int', () => {
    process.env.ZCLAUDIA_COMPACTION_MAX_FAILURES = '5';
    expect(resolveMaxFailures()).toBe(5);
  });
  it('resolveMaxFailures rejects junk and falls back', () => {
    process.env.ZCLAUDIA_COMPACTION_MAX_FAILURES = 'abc';
    expect(resolveMaxFailures()).toBe(DEFAULT_MAX_FAILURES);
    process.env.ZCLAUDIA_COMPACTION_MAX_FAILURES = '0';
    expect(resolveMaxFailures()).toBe(DEFAULT_MAX_FAILURES);
  });
  it('resolveCooldownMs honors valid positive int and falls back on junk', () => {
    process.env.ZCLAUDIA_COMPACTION_FAILURE_COOLDOWN_MS = '60000';
    expect(resolveCooldownMs()).toBe(60000);
    process.env.ZCLAUDIA_COMPACTION_FAILURE_COOLDOWN_MS = '-5';
    expect(resolveCooldownMs()).toBe(DEFAULT_COOLDOWN_MS);
  });
});
