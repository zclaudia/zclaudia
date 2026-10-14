import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const VIRTUALIZE_THRESHOLD = 80;
const VIRTUAL_ESTIMATED_HEIGHT = 120;
const VIRTUAL_OVERSCAN_PX = 900;

export interface VirtualWindow {
  start: number;
  end: number;
  topPadding: number;
  bottomPadding: number;
}

interface UseItemVirtualizerOptions {
  /** Number of renderable items (after filtering). */
  itemCount: number;
  scrollTop: number;
  viewportHeight: number;
  /**
   * Changing this key resets all measurements. Callers pass the first message
   * id so a session switch or prepending older history starts measuring fresh.
   */
  resetKey: string;
}

/**
 * Hand-rolled windowing + ResizeObserver measurement pipeline for the message
 * list. Items are measured via a ResizeObserver each, heights are coalesced
 * into one state flush per animation frame, and the visible window (with
 * overscan and padding spacers) is derived from the measured heights.
 */
export function useItemVirtualizer({
  itemCount,
  scrollTop,
  viewportHeight,
  resetKey,
}: UseItemVirtualizerOptions) {
  const [itemHeights, setItemHeights] = useState<ReadonlyMap<number, number>>(() => new Map());
  const itemHeightsRef = useRef<Map<number, number>>(new Map());
  const observersRef = useRef<Map<number, ResizeObserver>>(new Map());
  // Stable per-index ref callbacks so React doesn't tear down and re-attach
  // every visible item's ResizeObserver on each re-render.
  const measureRefsRef = useRef<Map<number, (el: HTMLDivElement | null) => void>>(new Map());
  // Coalesce height updates into one state flush per frame instead of one per
  // ResizeObserver callback (the streaming last item fires continuously).
  const heightFlushFrameRef = useRef<number | null>(null);

  const prevResetKeyRef = useRef(resetKey);
  useEffect(() => {
    // Reset measurements when the list head changes (session switch or prepending older history).
    if (prevResetKeyRef.current !== resetKey) {
      for (const ro of observersRef.current.values()) {
        ro.disconnect();
      }
      observersRef.current.clear();
      measureRefsRef.current.clear();
      itemHeightsRef.current.clear();
      if (heightFlushFrameRef.current != null) {
        cancelAnimationFrame(heightFlushFrameRef.current);
        heightFlushFrameRef.current = null;
      }
      setItemHeights(new Map());
      prevResetKeyRef.current = resetKey;
    }
  }, [resetKey]);

  useEffect(() => {
    const observers = observersRef.current;
    return () => {
      for (const ro of observers.values()) {
        ro.disconnect();
      }
      observers.clear();
      if (heightFlushFrameRef.current != null) {
        cancelAnimationFrame(heightFlushFrameRef.current);
        heightFlushFrameRef.current = null;
      }
    };
  }, []);

  const scheduleHeightFlush = useCallback(() => {
    if (heightFlushFrameRef.current != null) return;
    heightFlushFrameRef.current = requestAnimationFrame(() => {
      heightFlushFrameRef.current = null;
      setItemHeights(new Map(itemHeightsRef.current));
    });
  }, []);

  const shouldVirtualize = itemCount >= VIRTUALIZE_THRESHOLD && viewportHeight > 0;

  const getHeight = useCallback(
    (index: number) => {
      return itemHeights.get(index) ?? VIRTUAL_ESTIMATED_HEIGHT;
    },
    [itemHeights]
  );

  const setMeasuredRef = useCallback(
    (index: number, element: HTMLDivElement | null) => {
      const existing = observersRef.current.get(index);
      if (existing) {
        existing.disconnect();
        observersRef.current.delete(index);
      }

      if (!element) return;

      const updateHeight = (nextHeight: number) => {
        if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
        const prev = itemHeightsRef.current.get(index);
        if (prev !== nextHeight) {
          itemHeightsRef.current.set(index, nextHeight);
          scheduleHeightFlush();
        }
      };

      updateHeight(Math.ceil(element.getBoundingClientRect().height));

      const ro = new ResizeObserver(entries => {
        for (const entry of entries) {
          updateHeight(Math.ceil(entry.contentRect.height));
        }
      });
      ro.observe(element);
      observersRef.current.set(index, ro);
    },
    [scheduleHeightFlush]
  );

  // Cache one stable ref callback per index. React only invokes it when the
  // element at that position actually mounts/unmounts, not on every render.
  const getMeasureRef = useCallback(
    (index: number) => {
      let ref = measureRefsRef.current.get(index);
      if (!ref) {
        ref = (element: HTMLDivElement | null) => setMeasuredRef(index, element);
        measureRefsRef.current.set(index, ref);
      }
      return ref;
    },
    [setMeasuredRef]
  );

  const virtualWindow = useMemo<VirtualWindow>(() => {
    if (!shouldVirtualize) {
      return {
        start: 0,
        end: itemCount,
        topPadding: 0,
        bottomPadding: 0,
      };
    }

    let totalHeight = 0;
    for (let i = 0; i < itemCount; i++) {
      totalHeight += getHeight(i);
    }
    const maxScrollTop = Math.max(0, totalHeight - viewportHeight);
    const safeScrollTop = Math.min(Math.max(0, scrollTop), maxScrollTop);

    let start = 0;
    let y = 0;
    const startOffset = Math.max(0, safeScrollTop - VIRTUAL_OVERSCAN_PX);
    while (start < itemCount && y + getHeight(start) < startOffset) {
      y += getHeight(start);
      start++;
    }

    let end = start;
    let renderedBottom = y;
    const endOffset = safeScrollTop + viewportHeight + VIRTUAL_OVERSCAN_PX;
    while (end < itemCount && renderedBottom < endOffset) {
      renderedBottom += getHeight(end);
      end++;
    }

    return {
      start,
      end,
      topPadding: y,
      bottomPadding: Math.max(0, totalHeight - renderedBottom),
    };
  }, [itemCount, getHeight, scrollTop, shouldVirtualize, viewportHeight]);

  return { shouldVirtualize, virtualWindow, getMeasureRef };
}
