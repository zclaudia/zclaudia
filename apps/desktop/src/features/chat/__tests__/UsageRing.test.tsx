import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { UsageRing } from '../UsageRing';

const C = 2 * Math.PI * 7; // circumference, r = 7

// The arc is the second <circle> (the first is the track).
function arcOffset(container: HTMLElement): number {
  const circles = container.querySelectorAll('circle');
  return Number(circles[1].getAttribute('stroke-dashoffset'));
}

describe('UsageRing', () => {
  it('draws an empty arc at ratio 0 (offset == full circumference)', () => {
    const { container } = render(<UsageRing ratio={0} />);
    expect(arcOffset(container)).toBeCloseTo(C, 1);
  });

  it('draws a full arc at ratio 1 (offset == 0)', () => {
    const { container } = render(<UsageRing ratio={1} />);
    expect(arcOffset(container)).toBeCloseTo(0, 1);
  });

  it('clamps out-of-range ratios to [0,1]', () => {
    const { container } = render(<UsageRing ratio={1.5} />);
    expect(arcOffset(container)).toBeCloseTo(0, 1);
  });

  it('passes the color className to the svg (arc inherits via currentColor)', () => {
    const { container } = render(<UsageRing ratio={0.5} className="text-destructive" />);
    expect(container.querySelector('svg')!.getAttribute('class')).toContain('text-destructive');
  });
});
