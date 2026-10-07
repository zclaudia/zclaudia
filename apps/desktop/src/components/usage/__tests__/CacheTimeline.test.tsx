import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CacheTimelineCall } from '@zclaudia/shared/core/cache-stats';
import { CacheTimeline } from '../CacheTimeline';

function call(over: Partial<CacheTimelineCall>): CacheTimelineCall {
  return {
    invocationId: 'i1',
    callIndex: 0,
    at: Date.UTC(2026, 9, 7, 6, 30),
    model: 'm',
    tokens: { inputUncached: 10, cacheRead: 900, cacheWrite: 90 },
    output: 5,
    reuse: 1,
    verdict: 'hit',
    causes: [],
    ...over,
  };
}

describe('CacheTimeline', () => {
  it('draws one bar per call and lists the latest misses with their causes', () => {
    render(
      <CacheTimeline
        timeline={{
          truncated: false,
          calls: [
            call({ callIndex: 0, verdict: 'cold', reuse: null }),
            call({
              invocationId: 'i2',
              callIndex: 0,
              verdict: 'miss',
              reuse: 0.1,
              tokens: { inputUncached: 900, cacheRead: 100, cacheWrite: 0 },
              causes: ['prompt_changed', 'tools_changed'],
            }),
            call({ invocationId: 'i2', callIndex: 1 }),
          ],
        }}
      />
    );
    expect(screen.getByText('Last 3 calls')).toBeTruthy();
    expect(document.querySelectorAll('[data-verdict]')).toHaveLength(3);
    const rows = screen.getAllByTestId('cache-miss-row');
    expect(rows.map(r => r.textContent?.split('Latest')[0])).toEqual([
      'System prompt changed',
      'Tool set changed',
    ]);
    expect(rows[0].textContent).toContain('Call 1 · 10% hit · 10% reused');
  });

  it('groups misses by cause with counts, most frequent first', () => {
    const miss = (callIndex: number, cause: 'ttl_expired' | 'previous_turn_rewritten') =>
      call({ callIndex, verdict: 'miss', reuse: 0, causes: [cause] });
    render(
      <CacheTimeline
        timeline={{
          truncated: false,
          calls: [
            miss(0, 'ttl_expired'),
            miss(1, 'previous_turn_rewritten'),
            miss(2, 'previous_turn_rewritten'),
          ],
        }}
      />
    );
    expect(
      screen.getAllByTestId('cache-miss-row').map(r => r.textContent?.split('Latest')[0])
    ).toEqual(["Previous run's messages were re-shaped ×2", 'Cache expired while idle']);
  });

  it('says every call reused the prompt when nothing missed', () => {
    render(<CacheTimeline timeline={{ truncated: false, calls: [call({})] }} />);
    expect(screen.getByText('Every call reused the previous prompt.')).toBeTruthy();
  });

  it('renders nothing without traced calls', () => {
    const { container } = render(<CacheTimeline timeline={{ truncated: false, calls: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
