// Mobile drawer gesture engine for the app shell: three-detent stage state,
// direct transform/opacity painting, settle/repaint effects, and the horizontal drag
// handler. Extracted from App.tsx so the shell component reads as layout.
import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { isExcludedHorizontalDragStart, useHorizontalDrag } from '../hooks/useHorizontalDrag';
import {
  DRAWER_FLICK_VELOCITY,
  DRAWER_PEEK_WIDTH_PX,
  DRAWER_SETTLE_DURATION_MS,
  DRAWER_SETTLE_EASING,
  drawerExpandedWidth,
  drawerReleaseSettle,
  drawerStagePosition,
  resolveDrawerStage,
  type DrawerSettleTiming,
  type DrawerStage,
} from '../features/sidebar/drawerStage';

const BACKDROP_MAX_OPACITY = 0.5;
const STILL: DrawerSettleTiming = { durationMs: 0, easing: DRAWER_SETTLE_EASING };
const DEFAULT_SETTLE: DrawerSettleTiming = {
  durationMs: DRAWER_SETTLE_DURATION_MS,
  easing: DRAWER_SETTLE_EASING,
};

export interface UseMobileDrawerOptions {
  isMobile: boolean;
  /** Gesture surface is active in app mode or a shell mode (automations/agents/plugins). */
  gestureActive: boolean;
  isAgentExpanded: boolean;
  isFeedOpen: boolean;
  isFileViewerFullscreen: boolean;
}

export function useMobileDrawer({
  isMobile,
  gestureActive,
  isAgentExpanded,
  isFeedOpen,
  isFileViewerFullscreen,
}: UseMobileDrawerOptions) {
  // The mobile drawer has three detents; everything outside the gesture layer
  // still thinks in "open or not", so keep a boolean view over the stage.
  const [drawerStage, setDrawerStage] = useState<DrawerStage>('closed');
  const sidebarOpen = drawerStage !== 'closed';
  const setSidebarOpen = useCallback(
    (open: boolean) => setDrawerStage(open ? 'peek' : 'closed'),
    []
  );

  const drawerPanelRef = useRef<HTMLDivElement>(null);
  const drawerBackdropRef = useRef<HTMLDivElement>(null);
  const paintedWidthRef = useRef<number | null>(null);

  const viewportDrawerWidth = useCallback(
    () => drawerExpandedWidth(typeof window === 'undefined' ? 0 : window.innerWidth),
    []
  );

  /**
   * Paint the drawer at `position` pixels of revealed width. Below the peek
   * width the 300px panel slides in; above it the panel grows in place.
   *
   * Writes `transform`/`opacity` straight onto the two elements: they only
   * composite, where inherited custom properties would restyle every node in
   * the sidebar on each touchmove.
   */
  const setDrawerVisualPosition = useCallback(
    (position: number, timing: DrawerSettleTiming) => {
      const panel = drawerPanelRef.current;
      const backdrop = drawerBackdropRef.current;
      const expandedWidth = viewportDrawerWidth();
      const clamped = Math.min(expandedWidth, Math.max(0, position));
      const width = Math.max(DRAWER_PEEK_WIDTH_PX, clamped);
      const panelX = Math.min(0, clamped - DRAWER_PEEK_WIDTH_PX);
      const revealProgress = Math.min(1, clamped / DRAWER_PEEK_WIDTH_PX);
      const duration = `${timing.durationMs}ms`;

      if (panel) {
        panel.style.transitionDuration = duration;
        panel.style.transitionTimingFunction = timing.easing;
        panel.style.transform = `translate3d(${panelX}px, 0, 0)`;
        // Fully closed, the panel's shadow would still bleed onto the left
        // edge. Visibility is in the transition list, so it turns visible as
        // an open starts and only turns hidden once a close has finished.
        panel.style.visibility = clamped > 0 ? 'visible' : 'hidden';
        // Width is the one property that lays out; skip it while it holds.
        if (paintedWidthRef.current !== width) {
          paintedWidthRef.current = width;
          panel.style.width = `${width}px`;
        }
      }
      if (backdrop) {
        backdrop.style.transitionDuration = duration;
        backdrop.style.transitionTimingFunction = timing.easing;
        backdrop.style.opacity = String(BACKDROP_MAX_OPACITY * revealProgress);
      }
    },
    [viewportDrawerWidth]
  );

  /**
   * Where the drawer is on screen right now, including partway through a
   * settle, so a finger that catches it mid-flight picks it up where it is.
   */
  const readDrawerVisualPosition = useCallback((fallback: number) => {
    const panel = drawerPanelRef.current;
    if (!panel || typeof getComputedStyle === 'undefined') return fallback;
    const style = getComputedStyle(panel);
    const width = parseFloat(style.width);
    if (!Number.isFinite(width)) return fallback;
    if (width > DRAWER_PEEK_WIDTH_PX + 0.5) return width;
    const transform = style.transform;
    if (!transform || transform === 'none') return DRAWER_PEEK_WIDTH_PX;
    try {
      return DRAWER_PEEK_WIDTH_PX + new DOMMatrixReadOnly(transform).m41;
    } catch {
      return fallback;
    }
  }, []);

  const settleDrawer = useCallback(
    (stage: DrawerStage, timing: DrawerSettleTiming = DEFAULT_SETTLE) => {
      setDrawerVisualPosition(drawerStagePosition(stage, viewportDrawerWidth()), timing);
    },
    [setDrawerVisualPosition, viewportDrawerWidth]
  );

  // Button, backdrop, Escape, Android back, and menu navigation all continue to
  // drive the stage state; mirror those changes into the same styles used by
  // touch dragging. After a release the drawer is already heading there, and
  // re-targeting the same transform leaves its running transition alone.
  useEffect(() => {
    settleDrawer(drawerStage);
  }, [drawerStage, settleDrawer]);

  // The expanded stage is viewport-relative, so a rotation has to repaint it.
  useEffect(() => {
    if (drawerStage !== 'full' || typeof window === 'undefined') return;
    const repaint = () => settleDrawer('full');
    window.addEventListener('resize', repaint);
    return () => window.removeEventListener('resize', repaint);
  }, [drawerStage, settleDrawer]);

  const dragStartPositionRef = useRef(0);

  const drawerGestureRef = useHorizontalDrag<HTMLDivElement>({
    enabled:
      gestureActive && isMobile && !isAgentExpanded && !isFeedOpen && !isFileViewerFullscreen,
    // Once open the drawer can move either way: further right widens it to the
    // expanded stage, left steps back toward closed.
    direction: drawerStage === 'closed' ? 'right' : 'both',
    maxDistance: viewportDrawerWidth(),
    completionThreshold: 0.32,
    velocityThreshold: DRAWER_FLICK_VELOCITY,
    shouldStart: target => sidebarOpen || !isExcludedHorizontalDragStart(target),
    onDragStart: () => {
      dragStartPositionRef.current = readDrawerVisualPosition(
        drawerStagePosition(drawerStage, viewportDrawerWidth())
      );
      setDrawerVisualPosition(dragStartPositionRef.current, STILL);
    },
    onDrag: ({ distance }) =>
      setDrawerVisualPosition(dragStartPositionRef.current + distance, STILL),
    onEnd: ({ distance, velocity }) => {
      const expandedWidth = viewportDrawerWidth();
      const releasePosition = Math.min(
        expandedWidth,
        Math.max(0, dragStartPositionRef.current + distance)
      );
      const nextStage = resolveDrawerStage(releasePosition, velocity, expandedWidth);
      const target = drawerStagePosition(nextStage, expandedWidth);
      const towardTarget = target >= releasePosition ? velocity : -velocity;
      // Start the settle before React hears about it: the stage change
      // re-renders the shell, and running that first would hold the drawer
      // still for the length of the render right as the finger lifts.
      settleDrawer(nextStage, drawerReleaseSettle(target - releasePosition, towardTarget));
      if (nextStage !== drawerStage) startTransition(() => setDrawerStage(nextStage));
    },
    onCancel: () => settleDrawer(drawerStage),
  });

  return {
    drawerStage,
    setDrawerStage,
    sidebarOpen,
    setSidebarOpen,
    drawerPanelRef,
    drawerBackdropRef,
    drawerGestureRef,
  };
}
