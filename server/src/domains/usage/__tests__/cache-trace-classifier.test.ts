import { describe, expect, it } from 'vitest';
import { classifyCacheTimeline, type TraceCall, type TraceRun } from '../cache-trace-classifier.js';

const MIN = 60_000;

function run(id: string, startedAt: number, over: Partial<TraceRun> = {}): TraceRun {
  return {
    invocationId: id,
    startedAt,
    model: 'claude-sonnet-4-5',
    thinkingLevel: 'medium',
    cacheRetention: null,
    promptHash: 'p1',
    toolsHash: 't1',
    historyPrefixIntact: true,
    trimmedMessages: 0,
    ...over,
  };
}

function call(
  invocationId: string,
  callIndex: number,
  at: number,
  tokens: { u: number; r: number; w: number },
  model = 'claude-sonnet-4-5'
): TraceCall {
  return {
    invocationId,
    callIndex,
    at,
    model,
    tokens: { inputUncached: tokens.u, cacheRead: tokens.r, cacheWrite: tokens.w },
    output: 100,
  };
}

function classify(runs: TraceRun[], calls: TraceCall[], ctx = {}) {
  return classifyCacheTimeline(runs, calls, { forked: false, compactionsAt: [], ...ctx }).calls;
}

describe('classifyCacheTimeline', () => {
  it('first call is cold; a call reusing the previous prefix is a hit', () => {
    const out = classify(
      [run('a', 0)],
      [call('a', 0, 1000, { u: 10, r: 0, w: 5000 }), call('a', 1, 2000, { u: 10, r: 5010, w: 300 })]
    );
    expect(out.map(c => c.verdict)).toEqual(['cold', 'hit']);
    expect(out[0].reuse).toBeNull();
    expect(out[1].reuse).toBe(1);
    expect(out[1].causes).toEqual([]);
  });

  it('attributes a run-boundary miss to every prefix component that changed', () => {
    const out = classify(
      [
        run('a', 0),
        run('b', 2 * MIN, { promptHash: 'p2', toolsHash: 't2', thinkingLevel: 'high' }),
      ],
      [
        call('a', 0, 1000, { u: 0, r: 0, w: 5000 }),
        call('b', 0, 2 * MIN, { u: 5000, r: 0, w: 200 }),
      ]
    );
    expect(out[1].verdict).toBe('miss');
    expect(out[1].causes).toEqual(['prompt_changed', 'tools_changed', 'thinking_changed']);
  });

  it('detects a model switch', () => {
    const out = classify(
      [run('a', 0), run('b', MIN, { model: 'gpt-5.1' })],
      [
        call('a', 0, 1000, { u: 0, r: 0, w: 5000 }),
        call('b', 0, MIN, { u: 5000, r: 0, w: 0 }, 'gpt-5.1'),
      ]
    );
    expect(out[1].causes).toEqual(['model_changed']);
  });

  it('a compaction between the calls explains the miss', () => {
    const out = classify(
      [run('a', 0), run('b', MIN, { historyPrefixIntact: false })],
      [call('a', 0, 1000, { u: 0, r: 0, w: 5000 }), call('b', 0, MIN, { u: 3000, r: 0, w: 0 })],
      { compactionsAt: [30_000] }
    );
    expect(out[1].causes).toEqual(['compaction']);
  });

  it('a broken history prefix is trimming when the run dropped messages, else a rewrite', () => {
    const base = [
      call('a', 0, 1000, { u: 0, r: 0, w: 5000 }),
      call('b', 0, MIN, { u: 5000, r: 0, w: 0 }),
    ];
    expect(
      classify(
        [run('a', 0), run('b', MIN, { historyPrefixIntact: false, trimmedMessages: 4 })],
        base
      )[1].causes
    ).toEqual(['history_trimmed']);
    expect(
      classify([run('a', 0), run('b', MIN, { historyPrefixIntact: false })], base)[1].causes
    ).toEqual(['history_rewritten']);
  });

  it('a gap beyond the retention TTL expires the cache (5 min default, 1 h for long)', () => {
    const calls = [
      call('a', 0, 0, { u: 0, r: 0, w: 5000 }),
      call('b', 0, 10 * MIN, { u: 5000, r: 0, w: 0 }),
    ];
    expect(classify([run('a', 0), run('b', 10 * MIN)], calls)[1].causes).toEqual(['ttl_expired']);
    const long = classify(
      [run('a', 0, { cacheRetention: 'long' }), run('b', 10 * MIN, { cacheRetention: 'long' })],
      calls
    )[1];
    // Within a 1 h TTL and nothing else changed → the previous turn was re-shaped.
    expect(long.causes).toEqual(['previous_turn_rewritten']);
  });

  it('a partial run-boundary reuse with an intact older prefix points at the previous turn', () => {
    const out = classify(
      [run('a', 0), run('b', MIN)],
      [
        call('a', 0, 1000, { u: 0, r: 0, w: 4000 }),
        call('a', 1, 2000, { u: 0, r: 4000, w: 6000 }),
        call('b', 0, MIN, { u: 6000, r: 4000, w: 500 }),
      ]
    );
    expect(out[2].verdict).toBe('partial');
    expect(out[2].reuse).toBe(0.4);
    expect(out[2].causes).toEqual(['previous_turn_rewritten']);
  });

  it('within-run misses without a visible change are unknown', () => {
    const out = classify(
      [run('a', 0)],
      [call('a', 0, 1000, { u: 0, r: 0, w: 5000 }), call('a', 1, 2000, { u: 5000, r: 0, w: 0 })]
    );
    expect(out[1].causes).toEqual(['unknown']);
  });

  it('runs with caching turned off say so instead of guessing', () => {
    const out = classify(
      [run('a', 0, { cacheRetention: 'none' }), run('b', MIN, { cacheRetention: 'none' })],
      [call('a', 0, 1000, { u: 5000, r: 0, w: 0 }), call('b', 0, MIN, { u: 6000, r: 0, w: 0 })]
    );
    expect(out[1].verdict).toBe('miss');
    expect(out[1].causes).toEqual(['caching_disabled']);
  });

  it("marks a forked session's first call", () => {
    const out = classify([run('a', 0)], [call('a', 0, 1000, { u: 5000, r: 0, w: 0 })], {
      forked: true,
    });
    expect(out[0]).toMatchObject({ verdict: 'cold', causes: ['forked'] });
  });

  it('orders by run start then call index and keeps only the newest calls', () => {
    const result = classifyCacheTimeline(
      [run('b', MIN), run('a', 0)],
      [
        call('b', 0, MIN, { u: 0, r: 5000, w: 100 }),
        call('a', 1, 2000, { u: 0, r: 5000, w: 0 }),
        call('a', 0, 1000, { u: 0, r: 0, w: 5000 }),
      ],
      { forked: false, compactionsAt: [] },
      2
    );
    expect(result.truncated).toBe(true);
    expect(result.calls.map(c => `${c.invocationId}:${c.callIndex}`)).toEqual(['a:1', 'b:0']);
    // Classification still used the omitted first call as the baseline.
    expect(result.calls[0].verdict).toBe('hit');
  });
});
