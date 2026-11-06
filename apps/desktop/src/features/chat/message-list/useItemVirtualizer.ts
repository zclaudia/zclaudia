import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';

const VIRTUALIZE_THRESHOLD = 30;
const VIRTUAL_ESTIMATED_HEIGHT = 120;
const VIRTUAL_OVERSCAN_PX = 900;

export interface VirtualWindow {
  start: number;
  end: number;
  topPadding: number;
  bottomPadding: number;
}

interface UseItemVirtualizerOptions {
  /** Stable message identities keep measurements valid when history is prepended. */
  itemKeys: readonly string[];
  scrollTop: number;
  viewportHeight: number;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
}

/**
 * Hand-rolled windowing + ResizeObserver measurement pipeline for the message
 * list. Items are measured via a ResizeObserver each, heights are coalesced
 * into one state flush per animation frame, and the visible window (with
 * overscan and padding spacers) is derived from the measured heights.
 */
export function useItemVirtualizer({
  itemKeys,
  scrollTop,
  viewportHeight,
  scrollContainerRef,
}: UseItemVirtualizerOptions) {
  const itemCount = itemKeys.length;
  const committedKeysRef = useRef(itemKeys);
  const scrollAdjustmentRef = useRef({ scrollTop, offset: 0 });
  const [itemHeights, setItemHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const itemHeightsRef = useRef<Map<string, number>>(new Map());
  const observersRef = useRef<Map<string, ResizeObserver>>(new Map());
  // Stable per-message ref callbacks so React doesn't tear down and re-attach
  // every visible item's ResizeObserver on each re-render.
  const measureRefsRef = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map());
  // Coalesce height updates into one state flush per frame instead of one per
  // ResizeObserver callback (the streaming last item fires continuously).
  const heightFlushFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const currentKeys = new Set(itemKeys);
    // Detached rows keep useful heights, but removed messages/sessions do not
    // accumulate indefinitely. Do not disconnect newly attached observers here.
    for (const key of itemHeightsRef.current.keys()) {
      if (!currentKeys.has(key)) itemHeightsRef.current.delete(key);
    }
    for (const key of measureRefsRef.current.keys()) {
      if (!currentKeys.has(key)) measureRefsRef.current.delete(key);
    }
  }, [itemKeys]);

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

  // Bound the first render too, before the scroll container reports its size.
  const effectiveViewportHeight = viewportHeight > 0 ? viewportHeight : 600;
  const shouldVirtualize = itemCount >= VIRTUALIZE_THRESHOLD;

  const getHeight = useCallback(
    (index: number) => {
      return itemHeights.get(itemKeys[index]) ?? VIRTUAL_ESTIMATED_HEIGHT;
    },
    [itemHeights, itemKeys]
  );

  // Windowing needs a read-only snapshot of the committed list before a
  // prepend replaces its DOM. An effect-only snapshot would already have lost
  // the visible row. Snapshot refs are updated only in the layout effect below;
  // abandoned renders never mutate them or scroll the container.
  /* eslint-disable react-hooks/refs */
  const previousKeys = committedKeysRef.current;
  const prefixLength = previousKeys.length > 0 ? itemKeys.indexOf(previousKeys[0]) : 0;
  const isPrepend =
    prefixLength > 0 && previousKeys.every((key, index) => itemKeys[prefixLength + index] === key);
  let prependedHeight = 0;
  if (isPrepend) {
    for (let index = 0; index < prefixLength; index++) prependedHeight += getHeight(index);
  }
  const container = scrollContainerRef?.current;
  // Read the old DOM before React commits the prepended rows. The first new
  // window must retain the visible old message, even for very tall messages.
  let prependAnchor: { id: string; top: number } | null = null;
  if (isPrepend && container) {
    const containerTop = container.getBoundingClientRect().top;
    const previousKeySet = new Set(previousKeys);
    for (const element of container.querySelectorAll<HTMLElement>('[data-message-id]')) {
      const id = element.dataset.messageId;
      if (!id || !previousKeySet.has(id)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.bottom > containerTop) {
        prependAnchor = { id, top: rect.top };
        break;
      }
    }
  }
  const unreportedOffset =
    scrollAdjustmentRef.current.scrollTop === scrollTop ? scrollAdjustmentRef.current.offset : 0;
  const effectiveScrollTop =
    (container?.scrollTop ?? scrollTop + unreportedOffset) + prependedHeight;
  /* eslint-enable react-hooks/refs */

  useLayoutEffect(() => {
    const committedContainer = scrollContainerRef?.current;
    if (isPrepend && committedContainer) {
      const anchor =
        prependAnchor &&
        [...committedContainer.querySelectorAll<HTMLElement>('[data-message-id]')].find(
          element => element.dataset.messageId === prependAnchor.id
        );
      // Correct from the visible row, excluding unrelated growth at the tail.
      // Without an anchor, the estimated prefix still preserves list position.
      // eslint-disable-next-line react-hooks/immutability -- Mutate the DOM in the layout effect, not the ref or React props.
      committedContainer.scrollTop +=
        anchor && prependAnchor
          ? anchor.getBoundingClientRect().top - prependAnchor.top
          : prependedHeight;
    }
    scrollAdjustmentRef.current = {
      scrollTop,
      offset: committedContainer ? 0 : unreportedOffset + prependedHeight,
    };
    committedKeysRef.current = itemKeys;
  });

  const setMeasuredRef = useCallback(
    (key: string, element: HTMLDivElement | null) => {
      const existing = observersRef.current.get(key);
      if (existing) {
        existing.disconnect();
        observersRef.current.delete(key);
      }

      if (!element) return;

      const updateHeight = (nextHeight: number) => {
        if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
        const prev = itemHeightsRef.current.get(key);
        if (prev !== nextHeight) {
          itemHeightsRef.current.set(key, nextHeight);
          scheduleHeightFlush();
        }
      };

      updateHeight(Math.ceil(element.getBoundingClientRect().height));

      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(entries => {
        for (const entry of entries) {
          // The wrapper includes row spacing as padding. Measure the same
          // border box both on mount and on every resize.
          updateHeight(
            Math.ceil(
              entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height
            )
          );
        }
      });
      ro.observe(element, { box: 'border-box' });
      observersRef.current.set(key, ro);
    },
    [scheduleHeightFlush]
  );

  // Cache one stable ref callback per message. React only invokes it when the
  // element at that position actually mounts/unmounts, not on every render.
  const getMeasureRef = useCallback(
    (index: number) => {
      const key = itemKeys[index];
      let ref = measureRefsRef.current.get(key);
      if (!ref) {
        ref = (element: HTMLDivElement | null) => setMeasuredRef(key, element);
        measureRefsRef.current.set(key, ref);
      }
      return ref;
    },
    [setMeasuredRef, itemKeys]
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
    const maxScrollTop = Math.max(0, totalHeight - effectiveViewportHeight);
    const safeScrollTop = Math.min(Math.max(0, effectiveScrollTop), maxScrollTop);

    let start = 0;
    let y = 0;
    const startOffset = Math.max(0, safeScrollTop - VIRTUAL_OVERSCAN_PX);
    while (start < itemCount && y + getHeight(start) < startOffset) {
      y += getHeight(start);
      start++;
    }

    let end = start;
    let renderedBottom = y;
    const endOffset = safeScrollTop + effectiveViewportHeight + VIRTUAL_OVERSCAN_PX;
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
  }, [itemCount, getHeight, effectiveScrollTop, shouldVirtualize, effectiveViewportHeight]);

  return { shouldVirtualize, virtualWindow, getMeasureRef };
}
