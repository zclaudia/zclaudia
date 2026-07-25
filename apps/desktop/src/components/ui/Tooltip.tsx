import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Styled tooltip primitive replacing native `title=` attributes, which in the
 * WebView are slow (~1s), unstyled, and invisible to keyboard users. Shows on
 * hover (after a short delay) and immediately on keyboard focus; hides on
 * leave/blur/Escape. Rendered in a body portal, clamped to the viewport.
 */
interface TooltipProps {
  content: ReactNode;
  /** Wrapped control. The wrapper span is display:contents-free (inline-flex). */
  children: ReactNode;
  side?: 'top' | 'bottom';
  /** Hover delay in ms; focus shows immediately. */
  delay?: number;
  className?: string;
  /** Disable without unwrapping (e.g. when a menu is open on the same control). */
  disabled?: boolean;
}

const VIEWPORT_MARGIN = 8;

export function Tooltip({
  content,
  children,
  side = 'top',
  delay = 350,
  className = '',
  disabled = false,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const tipId = useId();

  const clearTimer = () => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const show = useCallback(
    (immediate: boolean) => {
      if (disabled) return;
      clearTimer();
      if (immediate) {
        setOpen(true);
      } else {
        timer.current = window.setTimeout(() => setOpen(true), delay);
      }
    },
    [disabled, delay]
  );

  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
    setStyle({ visibility: 'hidden' });
  }, []);

  useEffect(() => clearTimer, []);
  useEffect(() => {
    if (disabled) hide();
  }, [disabled, hide]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, hide]);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current?.getBoundingClientRect();
    const tip = tipRef.current?.getBoundingClientRect();
    if (!anchor || !tip) return;
    let top = side === 'top' ? anchor.top - tip.height - 6 : anchor.bottom + 6;
    if (top < VIEWPORT_MARGIN) top = anchor.bottom + 6;
    if (top + tip.height > window.innerHeight - VIEWPORT_MARGIN) {
      top = anchor.top - tip.height - 6;
    }
    let left = anchor.left + anchor.width / 2 - tip.width / 2;
    left = Math.min(
      Math.max(left, VIEWPORT_MARGIN),
      window.innerWidth - tip.width - VIEWPORT_MARGIN
    );
    setStyle({ top, left });
  }, [open, side]);

  return (
    <>
      <span
        ref={anchorRef}
        className="inline-flex"
        onMouseEnter={() => show(false)}
        onMouseLeave={hide}
        onFocus={() => show(true)}
        onBlur={hide}
        aria-describedby={open ? tipId : undefined}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={tipId}
            role="tooltip"
            style={style}
            className={`pointer-events-none fixed z-nested max-w-[280px] rounded-md border border-border/50 bg-popover px-2 py-1 text-[11px] text-foreground shadow-apple-md animate-apple-fade-in ${className}`.trim()}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
}
