import { createElement, useRef } from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useItemVirtualizer } from '../message-list/useItemVirtualizer';

describe('useItemVirtualizer', () => {
  let frames: FrameRequestCallback[];
  let observerCallbacks: ResizeObserverCallback[];
  beforeEach(() => {
    frames = [];
    observerCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback)
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          observerCallbacks.push(callback);
        }
        observe = vi.fn();
        disconnect = vi.fn();
      }
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const flushFrames = () =>
    act(() => {
      const pending = frames;
      frames = [];
      pending.forEach(callback => callback(0));
    });
  const keys = (count: number) => Array.from({ length: count }, (_, index) => `row-${index}`);

  it('bounds a first page even before viewport metrics arrive, keeping short lists intact', () => {
    const { result, rerender } = renderHook(props => useItemVirtualizer(props), {
      initialProps: { itemKeys: keys(50), scrollTop: 0, viewportHeight: 0 },
    });
    expect(result.current.shouldVirtualize).toBe(true);
    expect(result.current.virtualWindow.end).toBeLessThan(20);
    rerender({ itemKeys: keys(29), scrollTop: 0, viewportHeight: 500 });
    expect(result.current.shouldVirtualize).toBe(false);
    expect(result.current.virtualWindow).toEqual({
      start: 0,
      end: 29,
      topPadding: 0,
      bottomPadding: 0,
    });
  });

  it('measures padding consistently on mount and resize, preserving heights and refs after prepend', () => {
    const initialKeys = keys(50);
    const { result, rerender } = renderHook(props => useItemVirtualizer(props), {
      initialProps: { itemKeys: initialKeys, scrollTop: 0, viewportHeight: 500 },
    });
    let measuredHeight = 416;
    const element = document.createElement('div');
    element.getBoundingClientRect = () => ({ height: measuredHeight }) as DOMRect;
    const measureFirst = result.current.getMeasureRef(0);
    act(() => measureFirst(element));
    flushFrames();
    const totalHeight = () => {
      const { end, bottomPadding } = result.current.virtualWindow;
      return measuredHeight + (end - 1) * 120 + bottomPadding;
    };
    expect(totalHeight()).toBe(49 * 120 + 416);

    measuredHeight = 516;
    act(() =>
      observerCallbacks[0](
        [{ target: element, contentRect: { height: 500 } } as ResizeObserverEntry],
        {} as ResizeObserver
      )
    );
    flushFrames();
    expect(totalHeight()).toBe(49 * 120 + 516);

    rerender({ itemKeys: ['older', ...initialKeys], scrollTop: 0, viewportHeight: 500 });
    expect(result.current.getMeasureRef(1)).toBe(measureFirst);
    const { end, bottomPadding } = result.current.virtualWindow;
    expect(516 + (end - 1) * 120 + bottomPadding).toBe(50 * 120 + 516);
    expect(observerCallbacks).toHaveLength(1);
  });

  function renderMeasuredList(initialKeys: string[], heights: Record<string, number>) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      const height = this.dataset.viewport ? 500 : Number.parseFloat(this.style.height) || 0;
      let top = 0;
      if (this.dataset.messageId) {
        const siblings = [...this.parentElement!.children] as HTMLElement[];
        for (const sibling of siblings) {
          if (sibling === this) break;
          top += Number.parseFloat(sibling.style.height) || 0;
        }
        top -= this.closest<HTMLElement>('[data-viewport]')!.scrollTop;
      }
      return {
        top,
        bottom: top + height,
        height,
        left: 0,
        right: 400,
        width: 400,
        x: 0,
        y: top,
        toJSON() {},
      };
    });
    function MeasuredList({ itemKeys }: { itemKeys: string[] }) {
      const scrollContainerRef = useRef<HTMLDivElement>(null);
      const { virtualWindow, getMeasureRef } = useItemVirtualizer({
        itemKeys,
        scrollTop: 75,
        viewportHeight: 500,
        scrollContainerRef,
      });
      return createElement(
        'div',
        { ref: scrollContainerRef, 'data-viewport': true },
        createElement('div', { style: { height: virtualWindow.topPadding } }),
        ...itemKeys.slice(virtualWindow.start, virtualWindow.end).map((key, index) =>
          createElement(
            'div',
            {
              key,
              ref: getMeasureRef(virtualWindow.start + index),
              'data-message-id': key,
              style: { height: heights[key] ?? 4000 },
            },
            key
          )
        ),
        createElement('div', { style: { height: virtualWindow.bottomPadding } })
      );
    }
    const rendered = render(createElement(MeasuredList, { itemKeys: initialKeys }));
    const viewport = rendered.container.querySelector<HTMLDivElement>('[data-viewport]')!;
    const row = (key: string) =>
      [...viewport.querySelectorAll<HTMLElement>('[data-message-id]')].find(
        element => element.dataset.messageId === key
      );
    return {
      viewport,
      row,
      rerenderKeys: (itemKeys: string[]) =>
        rendered.rerender(createElement(MeasuredList, { itemKeys })),
    };
  }

  it('retains a tall visible message on the first prepended render and restores its DOM offset', () => {
    const original = keys(50);
    const { viewport, row, rerenderKeys } = renderMeasuredList(original, { 'row-0': 2500 });
    flushFrames();
    viewport.scrollTop = 75;
    expect(row('row-0')!.getBoundingClientRect().top).toBe(-75);
    rerenderKeys([...Array.from({ length: 20 }, (_, index) => `older-${index}`), ...original]);
    expect(row('row-0')).toBeDefined();
    expect(row('row-0')!.getBoundingClientRect().top).toBe(-75);
    // Resize measurements and a still-stale parent scrollTop must not send the
    // window back to the newly prepended head on the following frame.
    flushFrames();
    expect(row('row-0')).toBeDefined();
    expect(row('row-0')!.getBoundingClientRect().top).toBe(-75);
  });

  it.each([5, 29])('preserves the DOM anchor when prepending to a %i-row list', count => {
    const original = keys(count);
    const { viewport, row, rerenderKeys } = renderMeasuredList(original, { 'row-0': 2500 });
    flushFrames();
    viewport.scrollTop = 2700;
    expect(row('row-1')!.getBoundingClientRect().top).toBe(-200);
    rerenderKeys(['older', ...original]);
    expect(row('row-1')).toBeDefined();
    expect(row('row-1')!.getBoundingClientRect().top).toBe(-200);
    flushFrames();
    expect(row('row-1')!.getBoundingClientRect().top).toBe(-200);
  });

  it('does not preserve a previous session anchor when all message identities change', () => {
    const { viewport, rerenderKeys } = renderMeasuredList(keys(50), { 'row-0': 2500 });
    flushFrames();
    viewport.scrollTop = 75;
    rerenderKeys(keys(50).map(key => `other-session-${key}`));
    expect(viewport.scrollTop).toBe(75);
  });

  it('partitions the estimated list height exactly at the tail', () => {
    const { result } = renderHook(() =>
      useItemVirtualizer({
        itemKeys: keys(50),
        scrollTop: 5500,
        viewportHeight: 500,
      })
    );
    const window = result.current.virtualWindow;
    expect(window.end).toBe(50);
    expect(window.bottomPadding).toBe(0);
    expect(window.topPadding + (window.end - window.start) * 120).toBe(6000);
  });
});
