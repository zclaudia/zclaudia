import { useCallback, useRef } from 'react';
import type { SplitDir } from '../../stores/rightWorkspaceStore';

interface ResizeDividerProps {
  dir: SplitDir;
  /** Cross size of the flex container in px (width for row, height for col).
   *  Used to convert the pointer px delta into a ratio delta. */
  containerSize: number;
  /** Receives the incremental ratio delta (signed) to apply to the first child's share. */
  onDrag: (ratioDelta: number) => void;
  /** Opaque id of the owning group (forwarded as data-group-id for hit-testing/tests). */
  groupId?: string;
}

/**
 * Reusable drag divider between two split panes.
 *
 * - dir='row' (side-by-side panes): a vertical handle dragged along X.
 *   Moving the pointer right grows the FIRST child (ratio delta = +dX/size).
 * - dir='col' (stacked panes): a horizontal handle dragged along Y.
 *   Moving the pointer down grows the FIRST child (ratio delta = +dY/size).
 *
 * Uses document-level pointer listeners attached on pointerdown (and removed on
 * up/cancel), matching the existing RightSidebar/BottomPanel drag style. The drag
 * is armed only on a primary-button press for mouse input.
 */
export function ResizeDivider({ dir, containerSize, onDrag, groupId }: ResizeDividerProps) {
  const dragging = useRef(false);
  const startCoord = useRef(0);
  const cleanupRef = useRef<(() => void) | null>(null);
  const onDragRef = useRef(onDrag);
  onDragRef.current = onDrag;
  const sizeRef = useRef(containerSize);
  sizeRef.current = containerSize;

  const isRow = dir === 'row';

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only the primary button arms a mouse drag (buttons mask bit 0).
      if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) return;
      e.preventDefault();
      dragging.current = true;
      startCoord.current = isRow ? e.clientX : e.clientY;

      const onMove = (ev: PointerEvent) => {
        if (!dragging.current) return;
        const current = isRow ? ev.clientX : ev.clientY;
        const deltaPx = current - startCoord.current;
        const size = sizeRef.current > 0 ? sizeRef.current : 1;
        onDragRef.current(deltaPx / size);
        // Advance the baseline so each move reports an incremental delta.
        startCoord.current = current;
      };

      const cleanup = () => {
        dragging.current = false;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', cleanup);
        document.removeEventListener('pointercancel', cleanup);
        cleanupRef.current = null;
      };

      cleanupRef.current = cleanup;
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', cleanup);
      document.addEventListener('pointercancel', cleanup);
    },
    [isRow]
  );

  return (
    <div
      role="separator"
      data-group-id={groupId}
      aria-orientation={isRow ? 'vertical' : 'horizontal'}
      className={
        isRow
          ? 'group flex-shrink-0 w-1 flex items-center justify-center cursor-ew-resize'
          : 'group flex-shrink-0 h-1 flex items-center justify-center cursor-ns-resize'
      }
      onPointerDown={onPointerDown}
      style={{ touchAction: 'none' }}
    >
      {/* Handle: invisible at rest, revealed on hover/drag so the gutter stays clean. */}
      <div
        className={
          isRow
            ? 'h-8 w-1 rounded-full bg-muted-foreground/0 transition-colors group-hover:bg-muted-foreground/30 group-active:bg-muted-foreground/50'
            : 'w-8 h-1 rounded-full bg-muted-foreground/0 transition-colors group-hover:bg-muted-foreground/30 group-active:bg-muted-foreground/50'
        }
      />
    </div>
  );
}
