import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
  DESIGN_TIER_COMPACT,
  DESIGN_TIER_MEDIUM,
  DESIGN_TIER_WIDE,
  isCompactWidth,
  tierForWidth,
} from '../layout/tiers';
import { useElementTier } from '../hooks/useElementTier';

// 可控的 ResizeObserver 桩：把回调暴露出来，测试里手动派发 contentRect。
let observerCallback: ResizeObserverCallback | null = null;
const disconnectMock = vi.fn();

class ResizeObserverStub {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = disconnectMock;
  constructor(callback: ResizeObserverCallback) {
    observerCallback = callback;
  }
}

function emitWidth(width: number) {
  act(() => {
    observerCallback?.(
      [{ contentRect: { width, height: 0 } } as ResizeObserverEntry],
      null as unknown as ResizeObserver
    );
  });
}

function Harness() {
  const { ref, width, tier, compact } = useElementTier<HTMLDivElement>();
  return (
    <div
      ref={ref}
      data-testid="tier-harness"
      data-width={String(width)}
      data-tier={tier}
      data-compact={String(compact)}
    />
  );
}

function harness() {
  return screen.getByTestId('tier-harness');
}

describe('tierForWidth / isCompactWidth', () => {
  it('宽度 <= 0（未测量）按 wide 兜底', () => {
    expect(tierForWidth(0)).toBe('wide');
    expect(tierForWidth(-1)).toBe('wide');
  });

  it('边界值 959/960、639/640、359/360 映射到约定档位', () => {
    expect(tierForWidth(DESIGN_TIER_WIDE - 1)).toBe('medium');
    expect(tierForWidth(DESIGN_TIER_WIDE)).toBe('wide');
    expect(tierForWidth(DESIGN_TIER_MEDIUM - 1)).toBe('narrow');
    expect(tierForWidth(DESIGN_TIER_MEDIUM)).toBe('medium');
    expect(tierForWidth(DESIGN_TIER_COMPACT - 1)).toBe('narrow');
    expect(tierForWidth(DESIGN_TIER_COMPACT)).toBe('narrow');
  });

  it('compact 仅在 0 < 宽度 < 360 时为真', () => {
    expect(isCompactWidth(0)).toBe(false);
    expect(isCompactWidth(-10)).toBe(false);
    expect(isCompactWidth(DESIGN_TIER_COMPACT - 1)).toBe(true);
    expect(isCompactWidth(DESIGN_TIER_COMPACT)).toBe(false);
  });
});

describe('useElementTier', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    observerCallback = null;
    disconnectMock.mockClear();
  });

  it('初始宽度为 0，档位为 wide 且不紧凑', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    render(<Harness />);
    expect(harness().dataset.width).toBe('0');
    expect(harness().dataset.tier).toBe('wide');
    expect(harness().dataset.compact).toBe('false');
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it('观察回调派发的宽度驱动档位变化（959 -> medium、960 -> wide）', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    render(<Harness />);
    emitWidth(DESIGN_TIER_WIDE - 1);
    expect(harness().dataset.width).toBe('959');
    expect(harness().dataset.tier).toBe('medium');
    emitWidth(DESIGN_TIER_WIDE);
    expect(harness().dataset.width).toBe('960');
    expect(harness().dataset.tier).toBe('wide');
  });

  it('639 -> narrow、640 -> medium', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    render(<Harness />);
    emitWidth(DESIGN_TIER_MEDIUM - 1);
    expect(harness().dataset.tier).toBe('narrow');
    emitWidth(DESIGN_TIER_MEDIUM);
    expect(harness().dataset.tier).toBe('medium');
  });

  it('359 紧凑为真、360 紧凑为假（档位均为 narrow）', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    render(<Harness />);
    emitWidth(DESIGN_TIER_COMPACT - 1);
    expect(harness().dataset.tier).toBe('narrow');
    expect(harness().dataset.compact).toBe('true');
    emitWidth(DESIGN_TIER_COMPACT);
    expect(harness().dataset.tier).toBe('narrow');
    expect(harness().dataset.compact).toBe('false');
  });

  it('无 ResizeObserver（jsdom 默认）时保持初值不崩溃', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    render(<Harness />);
    expect(harness().dataset.width).toBe('0');
    expect(harness().dataset.tier).toBe('wide');
    expect(harness().dataset.compact).toBe('false');
  });

  it('卸载时断开 ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    const { unmount } = render(<Harness />);
    expect(disconnectMock).not.toHaveBeenCalled();
    unmount();
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });
});
