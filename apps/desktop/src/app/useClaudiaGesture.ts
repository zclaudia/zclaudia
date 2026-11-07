import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { animate, motionValue } from 'motion';
import type { MobileNavigationAdapter } from './useMobileNavigationGesture';

/** Continuous pixel position keeps the panel under the finger through interruption. */
export function useClaudiaGesture(expanded: boolean, enabled: boolean, setExpanded: (open: boolean) => void) {
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [position] = useState(() => motionValue(expanded ? 0 : window.innerWidth));
  const width = useRef(window.innerWidth);
  const target = useRef(expanded);
  const drag = useRef<{ start: number; open: boolean; distance: number } | null>(null);
  const animation = useRef<ReturnType<typeof animate> | null>(null);
  const version = useRef(0);
  const lastPanel = useRef<HTMLDivElement | null>(null);
  const pending = useRef(false);
  const paint = useCallback(() => {
    const x = Math.max(0, Math.min(width.current, position.get()));
    if (panelRef.current) panelRef.current.style.transform = `translate3d(${x}px, 0, 0)`;
    if (backdropRef.current) backdropRef.current.style.opacity = String((1 - x / width.current) * 0.14);
  }, [position]);
  const show = useCallback((visible: boolean) => {
    if (panelRef.current) {
      panelRef.current.style.visibility = visible ? 'visible' : 'hidden';
      panelRef.current.style.pointerEvents = visible ? 'auto' : 'none';
    }
    if (backdropRef.current) backdropRef.current.style.visibility = visible ? 'visible' : 'hidden';
  }, []);
  const stop = useCallback(() => {
    version.current += 1;
    animation.current?.stop();
    animation.current = null;
    pending.current = false;
    position.stop();
  }, [position]);
  const settle = useCallback(function startSettle(open: boolean, velocity = 0) {
    stop();
    target.current = open;
    show(true);
    const currentVersion = version.current;
    const destination = open ? 0 : width.current;
    const finish = () => {
      if (currentVersion !== version.current) return;
      position.set(destination);
      if (!open) show(false);
      animation.current = null;
    };
    if (Math.abs(position.get() - destination) < 0.5 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish();
    } else {
      const start = position.get();
      const safeVelocity = (start <= 0 && velocity < 0) || (start >= width.current && velocity > 0) ? 0 : velocity;
      animation.current = animate(position, destination, { type: 'spring', stiffness: 380, damping: 40, velocity: safeVelocity,
        onUpdate: value => {
          if (currentVersion !== version.current || (value >= 0 && value <= width.current)) return;
          stop();
          position.set(Math.max(0, Math.min(width.current, value)));
          startSettle(open);
        },
        onComplete: finish });
    }
  }, [position, show, stop]);
  useLayoutEffect(() => {
    const unsubscribe = position.on('change', paint);
    width.current = panelRef.current?.getBoundingClientRect().width || window.innerWidth;
    position.set(target.current ? 0 : width.current);
    paint();
    show(target.current);
    return () => { stop(); unsubscribe(); };
  }, [position, paint, show, stop]); // Initial attachment only; commands handled below.
  useLayoutEffect(() => {
    if (lastPanel.current !== panelRef.current) {
      lastPanel.current = panelRef.current;
      if (panelRef.current) {
        stop();
        width.current = panelRef.current.getBoundingClientRect().width || window.innerWidth;
        position.set(target.current ? 0 : width.current);
        paint();
        show(target.current);
      }
    }
  });
  useLayoutEffect(() => {
    if (target.current !== expanded) {
      drag.current = null;
      settle(expanded);
    }
  }, [expanded, settle]);
  useLayoutEffect(() => {
    if (!enabled && drag.current) {
      drag.current = null;
      settle(target.current);
    }
  }, [enabled, settle]);
  useLayoutEffect(() => {
    const resize = () => {
      stop();
      drag.current = null;
      width.current = panelRef.current?.getBoundingClientRect().width || window.innerWidth;
      position.set(target.current ? 0 : width.current);
      show(target.current);
    };
    const hidden = () => { if (document.hidden) resize(); };
    window.addEventListener('resize', resize);
    window.addEventListener('blur', resize);
    document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('resize', resize); window.removeEventListener('blur', resize); document.removeEventListener('visibilitychange', hidden); };
  }, [position, show, stop]);
  const adapter: MobileNavigationAdapter = {
    getGestureState: () => ({ present: expanded || position.get() < width.current, targetOpen: target.current, enabled, operationVersion: version.current }),
    pausePending: () => {
      if (!animation.current) return false;
      stop();
      pending.current = true;
      return true;
    },
    resumePending: () => { if (pending.current) settle(target.current); },
    beginDrag: () => {
      if (!enabled) return false;
      stop();
      drag.current = { start: position.get(), open: target.current, distance: 0 };
      show(true);
      return true;
    },
    updateDrag: distance => {
      if (!drag.current) return;
      drag.current.distance = distance;
      position.set(Math.max(0, Math.min(width.current, drag.current.start + distance)));
    },
    endDrag: ({ velocityPxPerSecond, releaseRunDistancePx }) => {
      const current = drag.current;
      if (!current) return;
      drag.current = null;
      const direction = current.open ? 1 : -1;
      const commit = direction * current.distance >= 60 ||
        (direction * velocityPxPerSecond >= (current.open ? 180 : 300) && direction * releaseRunDistancePx >= 16);
      const open = commit ? !current.open : current.open;
      settle(open, velocityPxPerSecond);
      if (open !== expanded) setExpanded(open);
    },
    cancelDrag: () => {
      if (!drag.current) return;
      const open = drag.current.open;
      drag.current = null;
      settle(open);
    },
  };
  return { adapter, panelRef, backdropRef };
}
