import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

const OPEN_DELAY = 180;
const CLOSE_DELAY = 150;
const GAP = 6;
const MARGIN = 8;

interface HoverPopoverProps {
  /** The trigger. */
  children: ReactNode;
  /** Panel body, rendered only while open. */
  content: ReactNode;
  /** Called each time the panel opens (fetch fresh data here). */
  onOpen?: () => void;
  panelTestId?: string;
}

/**
 * A small floating panel anchored to a compact indicator: opens on hover
 * (desktop) and on tap/click (mobile), closes on leaving, tapping outside or
 * Escape. Portaled with position:fixed so a clipping container (the composer)
 * cannot cut it off; placed above the anchor, right-aligned, flipping below
 * when there is no room.
 */
export function HoverPopover({ children, content, onOpen, panelTestId }: HoverPopoverProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback(() => {
    setOpen(true);
    onOpen?.();
  }, [onOpen]);

  const scheduleOpen = useCallback(() => {
    clearTimeout(closeTimer.current);
    openTimer.current = setTimeout(show, OPEN_DELAY);
  }, [show]);

  const cancelClose = useCallback(() => {
    clearTimeout(closeTimer.current);
  }, []);

  const scheduleClose = useCallback(() => {
    clearTimeout(openTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY);
  }, []);

  // Tap/click toggles immediately (no hover delay) — the touch path on mobile,
  // and a deliberate open/close affordance on desktop alongside hover.
  const toggleOnClick = useCallback(
    (e: ReactMouseEvent<HTMLSpanElement>) => {
      // The portaled panel is still a React-tree child of the anchor, so
      // synthetic clicks inside it bubble here. Interacting with the panel
      // (tapping to read, finishing a text selection) must not dismiss it.
      if (panelRef.current?.contains(e.target as Node)) return;
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
      if (open) setOpen(false);
      else show();
    },
    [open, show]
  );

  // While open, dismiss on tap/click outside the anchor and panel, or Escape.
  useEffect(() => {
    if (!open) return;
    const dismiss = () => {
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
      setOpen(false);
    };
    const onPointerDown = (e: Event) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      dismiss();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(
    () => () => {
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
    },
    []
  );

  return (
    <span
      ref={anchorRef}
      className="inline-flex"
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
      onClick={toggleOnClick}
    >
      {children}
      {open && (
        <PopoverPanel
          anchorRef={anchorRef}
          panelRef={panelRef}
          testId={panelTestId}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          content={content}
        />
      )}
    </span>
  );
}

function PopoverPanel({
  anchorRef,
  panelRef,
  testId,
  onMouseEnter,
  onMouseLeave,
  content,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  testId?: string;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  content: ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Re-placed whenever the content changes size (loading → loaded).
  useLayoutEffect(() => {
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      const m = panelRef.current;
      if (!a || !m) return;
      let left = a.right - m.offsetWidth; // right-align to the anchor…
      if (left < MARGIN) left = MARGIN; // …clamp to viewport
      let top = a.top - GAP - m.offsetHeight; // above the anchor…
      if (top < MARGIN) top = a.bottom + GAP; // …else below
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorRef, panelRef, content]);

  return createPortal(
    <div
      ref={panelRef}
      data-testid={testId}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
      }}
      // Opaque floating surface so chat content behind it can't bleed through.
      // Width is clamped to the viewport so it fits small phone screens (375px).
      className="z-50 w-[min(92vw,20rem)] overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
    >
      {content}
    </div>,
    document.body
  );
}
