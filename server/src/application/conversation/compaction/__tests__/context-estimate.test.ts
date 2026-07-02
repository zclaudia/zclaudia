import { describe, it, expect } from 'vitest';
import {
  COMPACTION_SUMMARY_RESERVE_TOKENS,
  COMPACTION_TRIGGER_BUFFER_TOKENS,
  compactionTriggerThreshold,
  lastAssistantPromptTokens,
  estimateContextTokensForThreshold,
  historyTokenBudget,
} from '../context-estimate.js';

// Minimal message shapes — the helpers only read role / stopReason / usage.

function asst(usage: Record<string, number> | undefined, stopReason = 'stop'): any {
  return { role: 'assistant', stopReason, usage, content: [] };
}

function user(): any {
  return { role: 'user', content: [] };
}

const WINDOW = 262_144;

describe('compactionTriggerThreshold', () => {
  it('subtracts summary reserve + trigger buffer from the window', () => {
    expect(compactionTriggerThreshold(WINDOW)).toBe(
      WINDOW - COMPACTION_SUMMARY_RESERVE_TOKENS - COMPACTION_TRIGGER_BUFFER_TOKENS
    );
    // ~85% of the window, not ~94%.
    expect(compactionTriggerThreshold(WINDOW)).toBe(221_760);
  });
});

describe('lastAssistantPromptTokens', () => {
  it('sums input + cacheRead + cacheWrite (prompt only, excludes output)', () => {
    const msgs = [
      asst({ input: 1000, output: 9999, cacheRead: 500, cacheWrite: 200, totalTokens: 11699 }),
    ];
    expect(lastAssistantPromptTokens(msgs)).toBe(1700);
  });

  it('uses the most recent usable assistant message', () => {
    const msgs = [
      asst({ input: 100, cacheRead: 0, cacheWrite: 0 }),
      user(),
      asst({ input: 2000, cacheRead: 50, cacheWrite: 0 }),
      user(),
    ];
    expect(lastAssistantPromptTokens(msgs)).toBe(2050);
  });

  it('skips error / aborted turns and messages without usage', () => {
    const msgs = [
      asst({ input: 500, cacheRead: 0, cacheWrite: 0 }),
      asst(undefined),
      asst({ input: 9, cacheRead: 0, cacheWrite: 0 }, 'error'),
    ];
    expect(lastAssistantPromptTokens(msgs)).toBe(500);
  });

  it('returns undefined when no assistant usage is present', () => {
    expect(lastAssistantPromptTokens([user(), user()])).toBeUndefined();
  });
});

describe('estimateContextTokensForThreshold', () => {
  const chars = (n: number) => () => n;

  it('prefers the real prompt anchor when it is within the window', () => {
    const msgs = [asst({ input: 200_000, cacheRead: 40_000, cacheWrite: 0 })];
    expect(estimateContextTokensForThreshold(msgs, WINDOW, chars(100_000))).toBe(240_000);
  });

  it('rejects a bogus anchor that exceeds the window and falls back to the chars estimate', () => {
    // 282614 + 281728 = 564342 — impossible for one request on a 262k model.
    const msgs = [
      asst({ input: 282_614, cacheRead: 281_728, cacheWrite: 0, totalTokens: 564_986 }),
    ];
    expect(estimateContextTokensForThreshold(msgs, WINDOW, chars(261_000))).toBe(261_000);
  });

  it('uses the chars estimate when no usage anchor exists', () => {
    expect(estimateContextTokensForThreshold([user()], WINDOW, chars(180_000))).toBe(180_000);
  });

  it('returns the larger of anchor and chars estimate (stays conservative)', () => {
    const msgs = [asst({ input: 100_000, cacheRead: 0, cacheWrite: 0 })];
    expect(estimateContextTokensForThreshold(msgs, WINDOW, chars(150_000))).toBe(150_000);
  });

  // Regression: a local openai-compat proxy (new-api) reported a CUMULATIVE
  // cacheRead far larger than the window on a single response. The bogus anchor
  // was correctly rejected (> window), but the DEFAULT chars estimator was pi's
  // usage-anchored estimateContextTokens, which re-derived the same poison from
  // usage and leaked it back through Math.max — so proactive compaction fired on
  // essentially every turn. The default estimator must be poison-proof.
  it('does not leak a proxy-poisoned usage anchor through the DEFAULT chars estimator', () => {
    const window = 1_000_000;
    const realText = 'x'.repeat(4_000); // ~1k tokens of genuine content
    const msgs = [
      { role: 'user', content: realText },
      asst({ input: 134_180, cacheRead: 11_262_848, cacheWrite: 0, totalTokens: 11_409_032 }),
    ];
    // No injected estimator — exercises the real default.

    const estimate = estimateContextTokensForThreshold(msgs as any, window);
    expect(estimate).toBeLessThan(compactionTriggerThreshold(window));
  });
});

describe('historyTokenBudget', () => {
  it('stays strictly below the compaction trigger threshold', () => {
    const w = 1_000_000;
    expect(historyTokenBudget(w)).toBeLessThan(compactionTriggerThreshold(w));
  });
  it('never negative for small windows', () => {
    expect(historyTokenBudget(1000)).toBe(0);
  });
});
