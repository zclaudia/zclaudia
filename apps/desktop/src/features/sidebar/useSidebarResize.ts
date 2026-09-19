import { useCallback, useEffect, useRef } from 'react';
import { useSidebarWidthStore } from '../../stores/sidebarWidthStore';

/** Keyboard resize step, in px, for the sidebar's resize handle. */
const RESIZE_KEY_STEP_PX = 16;

/**
 * Drag + keyboard resizing for the desktop sidebar's right-edge resize handle.
 * The width persists through the sidebar width store (whose setWidth applies
 * the same min/max clamp for both paths). Document listeners are removed on
 * pointer-up and on unmount.
 */
export function useSidebarResize() {
  const sidebarWidth = useSidebarWidthStore(s => s.widthPx);
  const setSidebarWidth = useSidebarWidthStore(s => s.setWidth);
  const resizeDragging = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => resizeCleanupRef.current?.(), []);
  const onResizeStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      resizeDragging.current = true;
      resizeStartX.current = 'touches' in e ? e.touches[0].clientX : e.clientX;
      resizeStartWidth.current = useSidebarWidthStore.getState().widthPx;
      const onMove = (ev: MouseEvent | TouchEvent) => {
        if (!resizeDragging.current) return;
        const clientX = 'touches' in ev ? ev.touches[0].clientX : ev.clientX;
        // Handle is on the right edge: dragging right widens the sidebar.
        setSidebarWidth(resizeStartWidth.current + (clientX - resizeStartX.current));
      };
      const cleanup = () => {
        resizeDragging.current = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        resizeCleanupRef.current = null;
      };
      const onUp = () => cleanup();
      resizeCleanupRef.current = cleanup;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove);
      document.addEventListener('touchend', onUp);
    },
    [setSidebarWidth]
  );
  // Keyboard resize: the handle sits on the right edge, so ArrowRight widens
  // the sidebar and ArrowLeft narrows it — same direction as dragging the
  // handle. Reuses the store's setWidth, which applies the same clamp as drag.
  const onResizeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSidebarWidth(useSidebarWidthStore.getState().widthPx + RESIZE_KEY_STEP_PX);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSidebarWidth(useSidebarWidthStore.getState().widthPx - RESIZE_KEY_STEP_PX);
      }
    },
    [setSidebarWidth]
  );

  return { sidebarWidth, onResizeStart, onResizeKeyDown };
}
