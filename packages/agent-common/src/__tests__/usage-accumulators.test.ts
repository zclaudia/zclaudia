import { beforeEach, describe, expect, it } from 'vitest';
import {
  ClaudeUsageAccumulator,
  CodexUsageAccumulator,
  CursorUsageAccumulator,
  countersToBreakdown,
} from '../usage-accumulators.js';

/**
 * Acceptance scenarios from the runtime usage design (§11): offline
 * fixture/replay tests are the primary verification, so these encode the
 * exact replay sequences the design table requires.
 */

// === Codex ===

const K = 1000;

function counters(totalTokens: number, inputTokens: number, cached = 0, output = 0) {
  return {
    totalTokens,
    inputTokens,
    cachedInputTokens: cached,
    cacheWriteInputTokens: 0,
    outputTokens: output,
    reasoningOutputTokens: 0,
  };
}

describe('CodexUsageAccumulator', () => {
  it('100k → 110k → 125k → 125k with a 100k baseline records 25k, not 60k or 15k', () => {
    const acc = new CodexUsageAccumulator({
      baseline: counters(100 * K, 90 * K, 0, 10 * K),
      baselineKnown: true,
    });
    // 110k is the first notification of this invocation.
    expect(acc.onNotification(counters(110 * K, 100 * K, 0, 10 * K))).not.toBeNull();
    const second = acc.onNotification(counters(125 * K, 112 * K, 0, 13 * K));
    expect(second?.tokens.total).toBe(25 * K);
    // Duplicate (identical counters) is dropped, not re-attributed.
    expect(acc.onNotification(counters(125 * K, 112 * K, 0, 13 * K))).toBeNull();
    const final = acc.finalize();

    expect(final.status).toBe('complete');
    expect(final.final).toBe(true);
    expect(final.tokens.total).toBe(25 * K);
    expect(final.tokens.inputUncached).toBe(22 * K);
    expect(final.tokens.output).toBe(3 * K);
  });

  it('normalizes the cached subset out of the input side', () => {
    const acc = new CodexUsageAccumulator({
      baseline: counters(100 * K, 100 * K, 90 * K),
      baselineKnown: true,
    });
    acc.onNotification(counters(135 * K, 125 * K, 115 * K, 10 * K));
    const final = acc.finalize();
    expect(final.status).toBe('complete');
    expect(final.tokens.total).toBe(35 * K);
    expect(final.tokens.inputUncached).toBe(0); // (125-100) - (115-90)
    expect(final.tokens.cacheRead).toBe(25 * K);
    expect(final.tokens.output).toBe(10 * K);
  });

  it('missing baseline: first request is not attributable — partial with provable deltas only', () => {
    const acc = new CodexUsageAccumulator({ baselineKnown: false });
    const first = acc.onNotification(counters(110 * K, 100 * K, 0, 10 * K));
    // Nothing attributable yet: missing, not a fabricated partial number.
    expect(first?.status).toBe('missing');
    expect(first?.reason).toBe('missing_baseline');
    expect(first?.tokens.total).toBeNull();

    acc.onNotification(counters(125 * K, 112 * K, 0, 13 * K));
    const final = acc.finalize();
    // Only the delta BETWEEN our own notifications is attributable.
    expect(final.status).toBe('partial');
    expect(final.tokens.total).toBe(15 * K);
    expect(final.reason).toBe('missing_baseline');
  });

  it('missing baseline with no attributable deltas reports missing, never fabricated totals', () => {
    const acc = new CodexUsageAccumulator({ baselineKnown: false });
    acc.onNotification(counters(110 * K, 100 * K, 0, 10 * K));
    const final = acc.finalize({ interrupted: true });
    expect(final.status).toBe('missing');
    expect(final.tokens.total).toBeNull();
    expect(final.final).toBe(true);
  });

  it('counter regression keeps only the proven prefix without a verified new epoch', () => {
    const acc = new CodexUsageAccumulator({
      baseline: counters(0, 0),
      baselineKnown: true,
    });
    acc.onNotification(counters(10 * K, 10 * K));
    // Thread accumulator reset (e.g. /clear): totals go backwards.
    const afterReset = acc.onNotification(counters(2 * K, 2 * K));
    expect(afterReset?.reason).toBe('counter_reset');
    acc.onNotification(counters(5 * K, 5 * K));
    const final = acc.finalize();
    expect(final.status).toBe('partial');
    // A rewind can be a stale notification; a new epoch has not been proven.
    expect(final.tokens.total).toBe(10 * K);
  });

  it('does not count a stale rewind and replay of the old high watermark twice', () => {
    const acc = new CodexUsageAccumulator({ baselineKnown: true });
    acc.onNotification(counters(100, 100));
    acc.onNotification(counters(50, 50));
    acc.onNotification(counters(100, 100));
    expect(acc.finalize().tokens.total).toBe(100);
  });

  it('fresh thread (proven zero baseline) is complete', () => {
    const acc = new CodexUsageAccumulator({ baselineKnown: true });
    acc.onNotification(counters(12 * K, 10 * K, 4 * K, 2 * K));
    const final = acc.finalize();
    expect(final.status).toBe('complete');
    expect(final.tokens.total).toBe(12 * K);
    expect(final.tokens.inputUncached).toBe(6 * K);
    expect(final.tokens.cacheRead).toBe(4 * K);
    // Checkpoint carries the thread-cumulative counters for the next resume.
    expect(final.checkpoint?.cumulative?.totalTokens).toBe(12 * K);
  });

  it('a turn with no notifications settles as missing', () => {
    const acc = new CodexUsageAccumulator({ baselineKnown: true });
    const final = acc.finalize();
    expect(final.status).toBe('missing');
  });
});

describe('countersToBreakdown', () => {
  it('cachedInputTokens is a SUBSET of inputTokens and must not double count', () => {
    const breakdown = countersToBreakdown(counters(300, 200, 150, 100));
    expect(breakdown.inputUncached).toBe(50);
    expect(breakdown.cacheRead).toBe(150);
    expect(breakdown.output).toBe(100);
    expect(breakdown.total).toBe(300);
    // Disjoint classification must reconcile with the source total.
    expect(
      breakdown.inputUncached! + breakdown.cacheRead! + breakdown.cacheWrite! + breakdown.output!
    ).toBe(breakdown.total);
  });
});

// === Claude ===

function claudeAssistant(id: string, usage: Record<string, number>, subagent = false) {
  return { messageId: id, isSubagent: subagent, usage };
}

describe('ClaudeUsageAccumulator', () => {
  let acc: ClaudeUsageAccumulator;
  beforeEach(() => {
    acc = new ClaudeUsageAccumulator();
  });

  it('the same message ID observed twice counts once (replay + parallel emit)', () => {
    acc.onAssistantUsage(claudeAssistant('msg_1', { input_tokens: 100, output_tokens: 10 }));
    const replay = acc.onAssistantUsage(
      claudeAssistant('msg_1', { input_tokens: 100, output_tokens: 10 })
    );
    expect(replay).toBeNull(); // identical replay → no new revision
    const final = acc.onResult({ errored: false });
    expect(final.tokens.total).toBe(110);
  });

  it('a repeated message id with a larger output grows by the difference, not the sum', () => {
    acc.onAssistantUsage(claudeAssistant('msg_1', { input_tokens: 100, output_tokens: 10 }));
    acc.onAssistantUsage(claudeAssistant('msg_1', { input_tokens: 100, output_tokens: 40 }));
    const final = acc.onResult({ errored: false });
    expect(final.tokens.output).toBe(40);
    expect(final.tokens.total).toBe(140);
  });

  it('does not lower the per-message dedupe baseline on regressed evidence', () => {
    acc.onAssistantUsage(claudeAssistant('m', { input_tokens: 100, output_tokens: 10 }));
    acc.onAssistantUsage(claudeAssistant('m', { input_tokens: 50, output_tokens: 20 }));
    acc.onAssistantUsage(claudeAssistant('m', { input_tokens: 100, output_tokens: 30 }));
    expect(acc.onInterrupted().tokens.total).toBe(130);
  });

  it('sub-agent messages never enter the main-loop accumulator', () => {
    expect(
      acc.onAssistantUsage(claudeAssistant('sub_1', { input_tokens: 500, output_tokens: 5 }, true))
    ).toBeNull();
    const final = acc.onResult({ errored: false });
    expect(final.tokens.total).toBeNull();
    expect(final.status).toBe('missing');
  });

  it('modelUsage assigns per-model allocations without adding them on top of the total', () => {
    const final = acc.onResult({
      errored: false,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      modelUsage: {
        'claude-sonnet-4-6': { inputTokens: 150, outputTokens: 30, cacheReadInputTokens: 1200 },
        'claude-haiku-4-5': { inputTokens: 10, outputTokens: 5 },
      },
    });
    expect(final.status).toBe('partial');
    // The invocation total IS the model sum — allocations are a breakdown,
    // never an addition on top.
    expect(final.tokens.total).toBe(1395);
    expect(final.models.map(m => m.modelId)).toEqual(['claude-sonnet-4-6', 'claude-haiku-4-5']);
    const modelSum = final.models.reduce((sum, m) => sum + (m.tokens.total ?? 0), 0);
    expect(modelSum).toBe(final.tokens.total);
  });

  it('result.usage exceeding the model sum is kept with a discrepancy, not forced into a bucket', () => {
    const final = acc.onResult({
      errored: false,
      usage: { input_tokens: 500, output_tokens: 50 },
      modelUsage: { 'claude-sonnet-4-6': { inputTokens: 100, outputTokens: 10 } },
    });
    expect(final.tokens.total).toBe(550);
    expect(final.discrepancy).toContain('exceeds sum(modelUsage)');
  });

  it('clean result is complete; error result keeps usage but downgrades to partial', () => {
    acc.onAssistantUsage(claudeAssistant('msg_1', { input_tokens: 100, output_tokens: 10 }));
    const errored = acc.onResult({
      errored: true,
      usage: { input_tokens: 100, output_tokens: 10 },
    });
    expect(errored.final).toBe(true);
    expect(errored.status).toBe('partial');
    expect(errored.reason).toBe('error_result');
    expect(errored.tokens.total).toBe(110);

    const fresh = new ClaudeUsageAccumulator();
    fresh.onAssistantUsage(claudeAssistant('m', { input_tokens: 1, output_tokens: 1 }));
    expect(fresh.onResult({ errored: false }).status).toBe('partial');
  });

  it('keeps observed consumption when a crash result zeroes its counters', () => {
    acc.onAssistantUsage(claudeAssistant('msg_1', { input_tokens: 100, output_tokens: 10 }));
    const result = acc.onResult({
      errored: true,
      usage: { input_tokens: 0, output_tokens: 0 },
      modelUsage: { m: { inputTokens: 0, outputTokens: 0 } },
    });
    expect(result.status).toBe('partial');
    expect(result.tokens.total).toBe(110);
    expect(result.models).toEqual([]);
  });

  it('does not promote assistant-only fallback to complete', () => {
    acc.onAssistantUsage(claudeAssistant('msg_1', { input_tokens: 100, output_tokens: 10 }));
    expect(acc.onResult({ errored: false }).status).toBe('partial');
  });

  it('interrupt without any usage reports missing; with usage reports partial', () => {
    const empty = new ClaudeUsageAccumulator().onInterrupted();
    expect(empty.status).toBe('missing');
    expect(empty.reason).toBe('interrupted');

    acc.onAssistantUsage(claudeAssistant('msg_1', { input_tokens: 42, output_tokens: 8 }));
    const partial = acc.onInterrupted('interrupted');
    expect(partial.status).toBe('partial');
    expect(partial.tokens.total).toBe(50);
  });

  it('snapshots carry ruleVersion and invocation scope for the host validator', () => {
    const snapshot = acc.onAssistantUsage(
      claudeAssistant('msg_1', { input_tokens: 1, output_tokens: 1 })
    )!;
    // Structural contract: the host-side validator (shared
    // parseRuntimeUsageSnapshot) must accept this shape — documented keys,
    // invocation scope, positive rule version.
    expect(Object.keys(snapshot).sort()).toEqual(
      ['final', 'models', 'revision', 'schemaVersion', 'source', 'status', 'tokens'].sort()
    );
    expect(snapshot.source.scope).toBe('invocation');
    expect(snapshot.source.kind).toBe('claude_assistant_usage');
    expect(snapshot.source.ruleVersion).toBeGreaterThan(0);
    expect(snapshot.schemaVersion).toBe(1);
  });
});

// === Cursor ===

describe('CursorUsageAccumulator', () => {
  it('a result without usage fields reports missing ("this version provides nothing")', () => {
    const final = new CursorUsageAccumulator().onResult(undefined);
    expect(final.status).toBe('missing');
    expect(final.reason).toBe('not_reported');
    expect(final.final).toBe(true);
    expect(final.tokens.total).toBeNull();
  });

  it('null-classification usage (context updates only) never becomes consumption', () => {
    // A payload of all-null nullable fields — the shape ACP documents — is
    // indistinguishable from "not provided" and must stay missing.
    const final = new CursorUsageAccumulator().onResult({
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      totalTokens: null,
    });
    expect(final.status).toBe('missing');
  });

  it('complete disjoint turn aggregates are complete; partial classification stays partial', () => {
    const complete = new CursorUsageAccumulator().onResult({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 300,
      cacheWriteTokens: 10,
    });
    expect(complete.status).toBe('complete');
    expect(complete.tokens.total).toBe(430);

    const partial = new CursorUsageAccumulator().onResult({ totalTokens: 55 });
    expect(partial.status).toBe('partial');
    expect(partial.reason).toBe('incomplete_classification');
    // Total-only evidence keeps the total but no fabricated detail.
    expect(partial.tokens.total).toBe(55);
    expect(partial.tokens.inputUncached).toBeNull();
  });
});
