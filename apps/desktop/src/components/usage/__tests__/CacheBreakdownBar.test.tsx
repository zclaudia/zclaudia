import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CacheBreakdownBar } from '../CacheBreakdownBar';
import { formatHitRate, formatShare } from '../cacheFormat';

describe('CacheBreakdownBar', () => {
  it('labels each bucket with its share of the input side', () => {
    render(<CacheBreakdownBar sums={{ inputUncached: 100, cacheRead: 800, cacheWrite: 100 }} />);
    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      'Read 80%, Written 10%, Uncached 10%'
    );
    expect(screen.getByText(/Read 80%/)).toBeInTheDocument();
  });

  it('renders nothing for an empty input side', () => {
    const { container } = render(
      <CacheBreakdownBar sums={{ inputUncached: 0, cacheRead: 0, cacheWrite: 0 }} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('cache formatting', () => {
  it('never rounds a non-zero share to 0% or a partial share to 100%', () => {
    expect(formatShare(0.004)).toBe('<1%');
    expect(formatShare(0.996)).toBe('>99%');
    expect(formatShare(1)).toBe('100%');
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(null)).toBe('—');
  });

  it('formats a hit rate from sums', () => {
    expect(formatHitRate({ inputUncached: 25, cacheRead: 75, cacheWrite: 0 })).toBe('75%');
    expect(formatHitRate(undefined)).toBe('—');
  });
});
