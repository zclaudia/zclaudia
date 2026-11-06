import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useGesture } from '@use-gesture/react';
import {
  NAVIGATION_ACTIVATION_PX, isExcludedNavigationTarget, navigationAxis,
  navigationRelease, nestedScrollerCanPan, sampleNavigation,
  type NavigationOwner, type NavigationRelease, type NavigationSample,
} from './mobileNavigationGesture';

export interface MobileNavigationAdapter {
  getGestureState(): { present: boolean; targetOpen: boolean; enabled?: boolean; operationVersion?: number };
  beginDrag(): boolean;
  updateDrag(distancePx: number): void;
  endDrag(release: NavigationRelease): void;
  cancelDrag(): void;
  pausePending?(): boolean;
  resumePending?(): void;
}

export interface UseMobileNavigationGestureOptions {
  target: RefObject<HTMLElement | null>;
  enabled: boolean;
  blocked?: boolean;
  drawer: MobileNavigationAdapter;
  claudia: MobileNavigationAdapter;
  /** Increment when commands/layout changes invalidate the current touch. */
  commandVersion?: unknown;
  /** Platform-configured system back gesture exclusion at either outer edge. */
  ignoreEdgeWidth?: number;
}

interface Session {
  owner: NavigationOwner;
  identifier: number;
  x: number;
  y: number;
  originX: number;
  target: EventTarget | null;
  samples: NavigationSample[];
  paused: boolean;
  adapter?: MobileNavigationAdapter;
  drawerVersion?: number;
  claudiaVersion?: number;
}

/** One drag recognizer arbitrates both panels; native scroll never hands back mid-touch. */
export function useMobileNavigationGesture(options: UseMobileNavigationGestureOptions) {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  const session = useRef<Session | null>(null);
  const liftClick = useRef<{ target: Node; expires: number } | null>(null);

  const cancel = useCallback(() => {
    const current = session.current;
    session.current = null;
    if (!current) return;
    if (current.adapter && (current.owner === 'drawer' || current.owner === 'claudia')) latest.current[current.owner].cancelDrag();
    else if (current.paused) latest.current.drawer.resumePending?.();
  }, []);

  const captureVersions = useCallback((current: Session) => {
    current.drawerVersion = latest.current.drawer.getGestureState().operationVersion;
    current.claudiaVersion = latest.current.claudia.getGestureState().operationVersion;
  }, []);
  const externallyChanged = useCallback((current: Session) => {
    return current.drawerVersion !== latest.current.drawer.getGestureState().operationVersion ||
      current.claudiaVersion !== latest.current.claudia.getGestureState().operationVersion;
  }, []);
  // Commands can arrive from a button/Android Back while a finger is still down.
  // Clear previews at that commit, without waiting for the remaining touchend.
  useLayoutEffect(() => {
    const current = session.current;
    if (current && current.owner !== 'native' && current.owner !== 'ignored' && externallyChanged(current)) cancel();
  });

  const nativeOwnership = useCallback((current: Session, owner: 'native' | 'ignored') => {
    current.owner = owner;
    if (current.paused) latest.current.drawer.resumePending?.();
    current.paused = false;
  }, []);

  useGesture({
    onTouchCancelCapture: () => cancel(),
    onClickCapture: ({ event }) => {
      const click = liftClick.current;
      if (!click || event.detail === 0 || performance.now() > click.expires) return;
      const target = event.target;
      if (target instanceof Node && (click.target.contains(target) || target.contains(click.target))) {
        event.preventDefault();
        event.stopPropagation();
        liftClick.current = null;
      }
    },
    onDrag: state => {
      const event = state.event;
      if (!('touches' in event)) return; // Desktop mouse and keyboard stay native.
      const touchEvent = event as TouchEvent;
      const config = latest.current;
      if (!config.enabled || config.blocked || state.canceled || touchEvent.type === 'touchcancel' || touchEvent.touches.length > 1) {
        cancel();
        return;
      }
      const touches = state.last ? touchEvent.changedTouches : touchEvent.touches;
      let touch: Touch | undefined;
      const active = session.current;
      for (let index = 0; index < touches.length; index += 1) {
        if (!active || touches[index].identifier === active.identifier) { touch = touches[index]; break; }
      }
      if (!touch) { cancel(); return; }
      const time = touchEvent.timeStamp;
      if (state.first) {
        cancel();
        const boundary = config.target.current;
        if (!boundary || touchEvent.touches.length !== 1) return;
        const rect = boundary.getBoundingClientRect();
        const width = rect.width || boundary.clientWidth || window.innerWidth;
        const edge = config.ignoreEdgeWidth ?? 0;
        const excluded = isExcludedNavigationTarget(touchEvent.target) ||
          (edge > 0 && (touch.clientX - rect.left < edge || touch.clientX - rect.left > width - edge));
        const visible = config.drawer.getGestureState().present;
        const surface = touchEvent.target instanceof Element && !!touchEvent.target.closest('[data-mobile-drawer-surface]');
        session.current = {
          owner: excluded ? 'ignored' : 'pending', identifier: touch.identifier,
          x: touch.clientX, y: touch.clientY, originX: touch.clientX,
          target: touchEvent.target, samples: [{ x: touch.clientX, time }],
          paused: !excluded && visible && surface ? !!config.drawer.pausePending?.() : false,
        };
        captureVersions(session.current);
        return;
      }
      const current = session.current;
      if (!current) return;
      if (current.owner === 'ignored' || current.owner === 'native') {
        if (state.last) session.current = null;
        return;
      }
      if (externallyChanged(current)) { cancel(); return; }
      const dx = touch.clientX - current.x;
      const dy = touch.clientY - current.y;
      if (current.owner === 'pending' && !state.last) {
        const axis = navigationAxis(dx, dy);
        if (axis === 'pending') return;
        const boundary = config.target.current;
        if (axis === 'native' || !boundary || nestedScrollerCanPan(current.target, boundary, dx)) {
          nativeOwnership(current, 'native');
          return;
        }
        const rect = boundary.getBoundingClientRect();
        const width = rect.width || boundary.clientWidth || window.innerWidth;
        const ratio = (current.x - rect.left) / width;
        const owner = config.drawer.getGestureState().present ? 'drawer' :
          config.claudia.getGestureState().present ? 'claudia' :
            dx > 0 ? 'drawer' : ratio >= 0.25 && ratio <= 0.75 ? 'claudia' : 'ignored';
        if (owner === 'ignored' || !touchEvent.cancelable) { nativeOwnership(current, 'ignored'); return; }
        const adapter = config[owner];
        if (adapter.getGestureState().enabled === false || !adapter.beginDrag()) {
          nativeOwnership(current, 'ignored');
          return;
        }
        current.owner = owner;
        current.adapter = adapter;
        current.paused = false;
        current.originX = current.x + Math.sign(dx) * NAVIGATION_ACTIVATION_PX;
        current.samples = [{ x: current.originX, time: current.samples[0].time }];
        captureVersions(current);
      }
      if (current.adapter) {
        // Adapters may be recreated during a React render; callbacks must stay fresh.
        if (current.owner === 'drawer' || current.owner === 'claudia') current.adapter = config[current.owner];
        if (!touchEvent.cancelable && !state.last) { cancel(); return; }
        if (touchEvent.cancelable) touchEvent.preventDefault();
        sampleNavigation(current.samples, touch.clientX, time);
        current.adapter.updateDrag(touch.clientX - current.originX);
        if (state.last) {
          session.current = null;
          if (current.target instanceof Node) liftClick.current = { target: current.target, expires: performance.now() + 400 };
          current.adapter.endDrag(navigationRelease(current.samples, touch.clientX, time));
        }
      } else if (state.last) {
        if (current.paused) config.drawer.resumePending?.();
        session.current = null;
      }
    },
  }, {
    target: options.target,
    eventOptions: { passive: false, capture: true },
    drag: { pointer: { touch: true, keys: false }, threshold: 0, filterTaps: false, triggerAllEvents: true },
  });

  useEffect(() => { cancel(); }, [options.enabled, options.blocked, options.commandVersion, cancel]);
  useEffect(() => {
    const onHidden = () => { if (document.hidden) cancel(); };
    // DragEngine ignores added-finger down events. Observe only their count at
    // window capture so an added finger outside the shell also cancels promptly;
    // coordinates/ownership remain exclusively with the one shell recognizer.
    const onTouchStart = (event: TouchEvent) => {
      liftClick.current = null;
      if (event.touches.length !== 1) cancel();
    };
    window.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('touchstart', onTouchStart, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      document.removeEventListener('visibilitychange', onHidden);
      cancel();
      liftClick.current = null;
    };
  }, [cancel]);
  return { cancel };
}
