import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';

/** The element's current width, or null before it is measured (or without ResizeObserver). */
export function usePanelWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => setWidth(element.getBoundingClientRect().width || null);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** Begin dragging the file-tree width: mouse or touch, tracked on window until release. */
export function useResizableTree({
  isMobile,
  treeWidth,
  setTreeWidthPx,
}: {
  isMobile: boolean;
  /** Drag from the width on screen, which may be narrower than the preference. */
  treeWidth: number;
  setTreeWidthPx: (widthPx: number) => void;
}): (event: ReactMouseEvent | ReactTouchEvent) => void {
  const treeResizeCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => treeResizeCleanupRef.current?.(), []);

  return useCallback(
    (event: ReactMouseEvent | ReactTouchEvent) => {
      if (isMobile) return;
      const startX = 'touches' in event ? event.touches[0]?.clientX : event.clientX;
      if (typeof startX !== 'number') return;
      event.preventDefault();
      treeResizeCleanupRef.current?.();

      // Drag from the width on screen, which may be narrower than the preference.
      const startWidth = treeWidth;
      const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
        const clientX = 'touches' in moveEvent ? moveEvent.touches[0]?.clientX : moveEvent.clientX;
        if (typeof clientX !== 'number') return;
        moveEvent.preventDefault();
        setTreeWidthPx(startWidth + clientX - startX);
      };
      const cleanup = () => {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', cleanup);
        window.removeEventListener('touchmove', handleMove);
        window.removeEventListener('touchend', cleanup);
        window.removeEventListener('touchcancel', cleanup);
        treeResizeCleanupRef.current = null;
      };

      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', cleanup);
      window.addEventListener('touchmove', handleMove, { passive: false });
      window.addEventListener('touchend', cleanup);
      window.addEventListener('touchcancel', cleanup);
      treeResizeCleanupRef.current = cleanup;
    },
    [isMobile, setTreeWidthPx, treeWidth]
  );
}
