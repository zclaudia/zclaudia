import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import type { ContextUsagePayload } from '@zclaudia/shared';
import { getSessionContextUsage } from '../../services/api';
import { ContextUsageCard } from './ContextUsageCard';
import { formatTokens } from '../../utils/formatTokens';
import { useIsMounted } from '../../hooks/useIsMounted';
import { useLatestRef } from '../../hooks/useLatestRef';

interface Props {
  sessionId: string;
  children: ReactNode;
  /** Cache-read tokens for the latest run (live store value, not in the snapshot). */
  latestCacheRead?: number;
}

const OPEN_DELAY = 180;
const CLOSE_DELAY = 150;
const GAP = 6;
const MARGIN = 8;

type FetchState =
  | { status: 'loading' }
  | { status: 'available'; usage: ContextUsagePayload }
  | { status: 'unavailable' }
  | { status: 'error' };

/**
 * Popover that reveals the full /context breakdown panel from the compact
 * input-box indicator. Wraps the trigger (`children`), fetches the server
 * snapshot on open, and renders the shared ContextUsageCard in a portaled
 * overlay. Opens on hover (desktop) and on tap/click (mobile); tapping
 * outside or pressing Escape closes it.
 */
export function ContextUsagePopover({ sessionId, children, latestCacheRead }: Props) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FetchState | null>(null);
  // Per-session stale-while-revalidate cache so re-hovering doesn't white-flash.
  const cacheRef = useRef<Map<string, ContextUsagePayload>>(new Map());
  const isMounted = useIsMounted();
  // Always holds the latest sessionId so an in-flight fetch can detect that the
  // component was re-pointed at a different session (it updates in place rather
  // than remounting) and drop its now-stale result.
  const sessionIdRef = useLatestRef(sessionId);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const doFetch = useCallback(async () => {
    const sid = sessionId;
    const cached = cacheRef.current.get(sid);
    setState(cached ? { status: 'available', usage: cached } : { status: 'loading' });
    try {
      const res = await getSessionContextUsage(sid);
      // Drop the result if we unmounted or switched sessions mid-flight.
      if (!isMounted() || sid !== sessionIdRef.current) return;
      if (!res.available) {
        setState({ status: 'unavailable' });
        return;
      }
      const { available: _available, ...usage } = res;
      cacheRef.current.set(sid, usage);
      setState({ status: 'available', usage });
    } catch {
      if (!isMounted() || sid !== sessionIdRef.current) return;
      setState({ status: 'error' });
    }
  }, [isMounted, sessionId, sessionIdRef]);

  const scheduleOpen = useCallback(() => {
    clearTimeout(closeTimer.current);
    openTimer.current = setTimeout(() => {
      setOpen(true);
      void doFetch();
    }, OPEN_DELAY);
  }, [doFetch]);

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
      if (open) {
        setOpen(false);
      } else {
        setOpen(true);
        void doFetch();
      }
    },
    [open, doFetch]
  );

  // While open, dismiss on tap/click outside the anchor and panel, or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: Event) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearTimeout(openTimer.current);
        clearTimeout(closeTimer.current);
        setOpen(false);
      }
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
        <PopoverBody
          anchorRef={anchorRef}
          panelRef={panelRef}
          state={state}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          latestCacheRead={latestCacheRead}
        />
      )}
    </span>
  );
}

function PopoverBody({
  anchorRef,
  panelRef,
  state,
  onMouseEnter,
  onMouseLeave,
  latestCacheRead,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  state: FetchState | null;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  latestCacheRead?: number;
}) {
  const ref = panelRef;
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Anchor above the indicator (it sits at the bottom-right of the composer),
  // flipping below if there's no room. Right-aligned to the indicator. Portaled
  // with position:fixed so the composer's overflow can't clip it.
  useLayoutEffect(() => {
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      const m = ref.current;
      if (!a || !m) return;
      const mw = m.offsetWidth;
      const mh = m.offsetHeight;
      let left = a.right - mw; // right-align to the indicator…
      if (left < MARGIN) left = MARGIN; // …clamp to viewport
      let top = a.top - GAP - mh; // above the indicator…
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
  }, [anchorRef, state]);

  return createPortal(
    <div
      ref={ref}
      data-testid="context-usage-popover"
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
      className="z-50 w-[min(92vw,20rem)] overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
    >
      {state?.status === 'available' && (
        <>
          <ContextUsageCard usage={state.usage} bare />
          {(latestCacheRead ?? 0) > 0 && (
            <div
              data-testid="popover-cache-line"
              className="border-t border-border/40 px-3 py-2 text-[10px] text-muted-foreground"
            >
              ↺ Prompt cache: {formatTokens(latestCacheRead ?? 0, { decimals: 0, upper: true })}{' '}
              read this turn
            </div>
          )}
        </>
      )}
      {state?.status === 'loading' && (
        <div className="px-3 py-2.5 text-xs text-muted-foreground">Loading context usage…</div>
      )}
      {state?.status === 'unavailable' && (
        <div
          data-testid="context-usage-popover-empty"
          className="px-3 py-2.5 text-xs text-muted-foreground"
        >
          No context data yet — send a message first.
        </div>
      )}
      {state?.status === 'error' && (
        <div className="px-3 py-2.5 text-xs text-destructive">Failed to load context usage.</div>
      )}
    </div>,
    document.body
  );
}
