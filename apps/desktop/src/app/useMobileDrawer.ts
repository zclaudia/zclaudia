import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate, motionValue } from 'motion';
import { useIsMounted } from '../hooks/useIsMounted';
import {
  clampDrawerPosition, DRAWER_MOTION, drawerSpringVelocity, drawerVisuals, drawerWidths,
  resolveDrawerOpen, type DrawerPhase, type DrawerWidthMode,
} from '../features/sidebar/drawerMotion';

export interface UseMobileDrawerOptions {
  isMobile: boolean;
  gestureActive: boolean;
  isAgentExpanded: boolean;
  isFeedOpen: boolean;
  isFileViewerFullscreen: boolean;
}
interface DrawerState {
  phase: DrawerPhase;
  targetOpen: boolean;
  modalActive: boolean;
  widthMode: DrawerWidthMode;
  canExpand: boolean;
}
export interface DrawerRelease {
  velocityPxPerSecond: number;
  releaseRunDistancePx: number;
}

/** One continuous position; React receives only discrete lifecycle changes. */
export function useMobileDrawer(options: UseMobileDrawerOptions) {
  const optionsRef = useRef(options);
  useLayoutEffect(() => { optionsRef.current = options; }, [options]);
  const drawerPanelRef = useRef<HTMLDivElement>(null);
  const drawerBackdropRef = useRef<HTMLDivElement>(null);
  const [drawerPosition] = useState(() => motionValue(0));
  const [state, setState] = useState<DrawerState>({ phase: 'idle', targetOpen: false,
    modalActive: false, widthMode: 'compact', canExpand: false });
  const stateRef = useRef(state);
  const widthRef = useRef(0);
  const widthsRef = useRef(drawerWidths(0));
  const animationRef = useRef<ReturnType<typeof animate> | null>(null);
  const versionRef = useRef(0);
  const isMounted = useIsMounted();
  const dragRef = useRef<{ start: number; width: number; priorTargetOpen: boolean } | null>(null);
  const pendingRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const resetLayoutRef = useRef<(hide?: boolean) => void>(() => {});
  const lastPanelRef = useRef<HTMLDivElement | null>(null);

  const publish = useCallback((patch: Partial<DrawerState>) => {
    stateRef.current = { ...stateRef.current, ...patch };
    if (isMounted()) setState(stateRef.current);
  }, [isMounted]);
  const paint = useCallback(() => {
    const panel = drawerPanelRef.current;
    const backdrop = drawerBackdropRef.current;
    const p = drawerPosition.get();
    const { x, opacity } = drawerVisuals(p, widthRef.current);
    const visible = p > 0 || stateRef.current.targetOpen;
    if (panel) {
      panel.style.transform = `translate3d(${x}px, 0, 0)`;
      // Width is fixed throughout every drag/settle, so avoid repeated layout writes.
      const width = `${widthRef.current}px`;
      if (panel.style.width !== width) panel.style.width = width;
      const visibility = visible ? 'visible' : 'hidden';
      if (panel.style.visibility !== visibility) panel.style.visibility = visibility;
      const pointerEvents = visible ? 'auto' : 'none';
      if (panel.style.pointerEvents !== pointerEvents) panel.style.pointerEvents = pointerEvents;
    }
    if (backdrop) {
      backdrop.style.opacity = String(opacity);
      const pointerEvents = visible || stateRef.current.modalActive ? 'auto' : 'none';
      if (backdrop.style.pointerEvents !== pointerEvents) backdrop.style.pointerEvents = pointerEvents;
    }
  }, [drawerPosition]);
  const stop = useCallback(() => {
    // Increment first, including when stop synchronously runs an old completion.
    versionRef.current += 1;
    animationRef.current?.stop();
    animationRef.current = null;
    drawerPosition.stop();
    dragRef.current = null;
    pendingRef.current = false;
    return versionRef.current;
  }, [drawerPosition]);
  const finish = useCallback((open: boolean, version: number) => {
    if (!isMounted() || version !== versionRef.current) return;
    animationRef.current?.stop();
    animationRef.current = null;
    if (!open) widthRef.current = widthsRef.current.compact;
    drawerPosition.set(open ? widthRef.current : 0);
    const widthButton = drawerPanelRef.current?.querySelector<HTMLButtonElement>('[data-drawer-width-toggle]');
    if (widthButton) widthButton.disabled = !open;
    publish({ phase: 'idle', targetOpen: open, modalActive: open,
      ...(open ? {} : { widthMode: 'compact' as const }) });
    paint();
  }, [drawerPosition, paint, publish, isMounted]);
  const settle = useCallback((open: boolean, velocity = 0) => {
    const version = stop();
    publish({ phase: 'settling', targetOpen: open,
      modalActive: open || stateRef.current.modalActive });
    paint();
    const target = open ? widthRef.current : 0;
    if (reducedMotionRef.current || Math.abs(drawerPosition.get() - target) < 0.5) {
      finish(open, version);
      return;
    }
    animationRef.current = animate(drawerPosition, target, {
      type: 'spring', ...DRAWER_MOTION.spring,
      velocity: drawerSpringVelocity(drawerPosition.get(), widthRef.current, velocity),
      onUpdate: value => {
        // A large release velocity can reach a boundary before the spring rests.
        if (version === versionRef.current && (value < 0 || value > widthRef.current)) finish(open, version);
      },
      onComplete: () => finish(open, version),
    });
  }, [drawerPosition, finish, paint, publish, stop]);
  const enabled = useCallback(() => {
    const o = optionsRef.current;
    const present = drawerPosition.get() > 0 || stateRef.current.modalActive || stateRef.current.targetOpen;
    return o.isMobile && o.gestureActive && (!o.isAgentExpanded && !o.isFeedOpen || present) && !o.isFileViewerFullscreen;
  }, [drawerPosition]);
  const setSidebarOpen = useCallback((open: boolean) => {
    if (!optionsRef.current.isMobile) return;
    // Menu/open commands choose the normal reading width.
    if (open && stateRef.current.widthMode !== 'compact') {
      const wasOpen = stateRef.current.targetOpen;
      widthRef.current = widthsRef.current.compact;
      drawerPosition.set(wasOpen ? widthRef.current : clampDrawerPosition(drawerPosition.get(), widthRef.current));
      publish({ widthMode: 'compact' });
    }
    settle(open);
  }, [drawerPosition, publish, settle]);
  const toggleWidth = useCallback(() => {
    const s = stateRef.current;
    if (!s.targetOpen || s.phase !== 'idle' || !widthsRef.current.canExpand) return;
    stop();
    const widthMode = s.widthMode === 'compact' ? 'wide' : 'compact';
    widthRef.current = widthsRef.current[widthMode];
    drawerPosition.set(widthRef.current);
    publish({ widthMode });
    paint();
  }, [drawerPosition, paint, publish, stop]);
  const stepBack = useCallback(() => {
    if (stateRef.current.targetOpen && stateRef.current.widthMode === 'wide') {
      stop();
      widthRef.current = widthsRef.current.compact;
      drawerPosition.set(widthRef.current);
      publish({ widthMode: 'compact', phase: 'idle' });
      paint();
    } else settle(false);
  }, [drawerPosition, paint, publish, settle, stop]);
  const beginDrag = useCallback(() => {
    if (!enabled()) return false;
    const priorTargetOpen = stateRef.current.targetOpen;
    stop();
    dragRef.current = { start: drawerPosition.get(), width: widthRef.current, priorTargetOpen };
    // Keep the drag phase synchronous without rendering the entire app on touchmove activation.
    stateRef.current = { ...stateRef.current, phase: 'dragging' };
    const widthButton = drawerPanelRef.current?.querySelector<HTMLButtonElement>('[data-drawer-width-toggle]');
    if (widthButton) widthButton.disabled = true;
    paint();
    return true;
  }, [drawerPosition, enabled, paint, stop]);
  const updateDrag = useCallback((distancePx: number) => {
    const drag = dragRef.current;
    if (drag) drawerPosition.set(clampDrawerPosition(drag.start + distancePx, drag.width));
  }, [drawerPosition]);
  const endDrag = useCallback((release: DrawerRelease) => {
    const drag = dragRef.current;
    if (!drag) return;
    const open = resolveDrawerOpen({ position: drawerPosition.get(), width: drag.width,
      priorTargetOpen: drag.priorTargetOpen, ...release });
    settle(open, release.velocityPxPerSecond);
  }, [drawerPosition, settle]);
  const cancelDrag = useCallback(() => {
    const drag = dragRef.current;
    if (drag) settle(drag.priorTargetOpen);
  }, [settle]);
  const pausePending = useCallback(() => {
    if (!enabled() || stateRef.current.phase !== 'settling' || drawerPosition.get() <= 0) return false;
    stop();
    pendingRef.current = true;
    publish({ phase: 'pending' });
    return true;
  }, [drawerPosition, enabled, publish, stop]);
  const resumePending = useCallback(() => {
    if (pendingRef.current) settle(stateRef.current.targetOpen);
  }, [settle]);
  const getGestureState = useCallback(() => ({ enabled: enabled(),
    present: drawerPosition.get() > 0 || stateRef.current.modalActive || stateRef.current.targetOpen,
    targetOpen: stateRef.current.targetOpen, phase: stateRef.current.phase,
    operationVersion: versionRef.current,
  }), [drawerPosition, enabled]);

  useLayoutEffect(() => {
    const panel = drawerPanelRef.current;
    const backdrop = drawerBackdropRef.current;
    if (panel) panel.style.transition = 'none';
    if (backdrop) backdrop.style.transition = 'none';
    const unsubscribe = drawerPosition.on('change', paint);
    paint();
    return () => {
      stop();
      unsubscribe();
      panel?.removeAttribute('style');
      backdrop?.removeAttribute('style');
    };
  }, [drawerPosition, paint, stop]);
  useLayoutEffect(() => {
    const reset = (hide = false) => {
      stop();
      if (hide || !optionsRef.current.isMobile || !optionsRef.current.gestureActive) {
        widthRef.current = 0;
        drawerPosition.set(0);
        publish({ phase: 'idle', targetOpen: false, modalActive: false, widthMode: 'compact' });
        drawerPanelRef.current?.removeAttribute('style');
        drawerBackdropRef.current?.removeAttribute('style');
        return;
      }
      const panel = drawerPanelRef.current;
      const widthButton = panel?.querySelector<HTMLButtonElement>('[data-drawer-width-toggle]');
      if (widthButton) widthButton.disabled = !stateRef.current.targetOpen;
      const shell = panel?.closest('[data-mobile-navigation-shell]');
      const containerWidth = shell?.getBoundingClientRect().width || window.innerWidth;
      // Resolve safe-area env() through computed padding on a measurement-only element.
      const safeArea = document.createElement('div');
      safeArea.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px)';
      document.body.appendChild(safeArea);
      const style = window.getComputedStyle(safeArea);
      const safeWidth = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      safeArea.remove();
      widthsRef.current = drawerWidths(containerWidth - safeWidth);
      const open = stateRef.current.targetOpen;
      const widthMode = open && widthsRef.current.canExpand ? stateRef.current.widthMode : 'compact';
      widthRef.current = widthsRef.current[widthMode];
      drawerPosition.set(open ? widthRef.current : 0);
      publish({ phase: 'idle', modalActive: open, widthMode, canExpand: widthsRef.current.canExpand });
      paint();
    };
    resetLayoutRef.current = reset;
    reset();
    const resize = () => reset();
    const visibility = () => reset(document.hidden);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [options.isMobile, options.gestureActive, drawerPosition, paint, publish, stop]);
  useLayoutEffect(() => {
    // Settings/setup temporarily unmount the shell while this hook remains alive.
    if (lastPanelRef.current !== drawerPanelRef.current) {
      lastPanelRef.current = drawerPanelRef.current;
      if (drawerPanelRef.current) resetLayoutRef.current();
    }
  });
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => {
      reducedMotionRef.current = media.matches;
      if (media.matches && stateRef.current.phase === 'settling') settle(stateRef.current.targetOpen);
    };
    change();
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, [settle]);
  useEffect(() => {
    if (!enabled()) {
      if (dragRef.current) cancelDrag();
      else resumePending();
    }
  }, [options.gestureActive, options.isAgentExpanded, options.isFeedOpen,
    options.isFileViewerFullscreen, enabled, cancelDrag, resumePending]);

  return { ...state, sidebarOpen: state.modalActive,
    drawerVisible: state.modalActive || state.phase !== 'idle' || state.targetOpen,
    widthChangeDisabled: !state.targetOpen || state.phase !== 'idle',
    drawerPanelRef, drawerBackdropRef, drawerPosition, setSidebarOpen, toggleWidth, stepBack,
    beginDrag, updateDrag, endDrag, cancelDrag, pausePending, resumePending, getGestureState };
}
