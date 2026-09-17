// Mobile drawer gesture engine for the app shell: three-detent stage state,
// CSS-variable painting, settle/repaint effects, and the horizontal drag
// handler. Extracted from App.tsx so the shell component reads as layout.
import { useCallback, useEffect, useRef, useState } from 'react';
import { isInteractiveHorizontalDragStart, useHorizontalDrag } from '../hooks/useHorizontalDrag';
import {
  DRAWER_PEEK_WIDTH_PX,
  drawerExpandedWidth,
  drawerStagePosition,
  resolveDrawerStage,
  type DrawerStage,
} from '../features/sidebar/drawerStage';

const BACKDROP_MAX_OPACITY = 0.5;
const SETTLE_DURATION_MS = 350;

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

  const viewportDrawerWidth = useCallback(
    () => drawerExpandedWidth(typeof window === 'undefined' ? 0 : window.innerWidth),
    []
  );

  /**
   * Paint the drawer at `position` pixels of revealed width. Below the peek
   * width the 300px panel slides in; above it the panel grows in place.
   */
  const setDrawerVisualPosition = useCallback(
    (position: number, transitionDurationMs: number) => {
      const expandedWidth = viewportDrawerWidth();
      const clamped = Math.min(expandedWidth, Math.max(0, position));
      const width = Math.max(DRAWER_PEEK_WIDTH_PX, clamped);
      const panelX = Math.min(0, clamped - DRAWER_PEEK_WIDTH_PX);
      const revealProgress = Math.min(1, clamped / DRAWER_PEEK_WIDTH_PX);
      const backdropOpacity = BACKDROP_MAX_OPACITY * revealProgress;
      const transitionDuration = `${transitionDurationMs}ms`;

      drawerPanelRef.current?.style.setProperty('--drawer-transition-duration', transitionDuration);
      drawerPanelRef.current?.style.setProperty('--drawer-panel-x', `${panelX}px`);
      drawerPanelRef.current?.style.setProperty('--drawer-width', `${width}px`);
      drawerBackdropRef.current?.style.setProperty(
        '--drawer-transition-duration',
        transitionDuration
      );
      drawerBackdropRef.current?.style.setProperty(
        '--drawer-backdrop-opacity',
        String(backdropOpacity)
      );
    },
    [viewportDrawerWidth]
  );

  const settleDrawer = useCallback(
    (stage: DrawerStage) => {
      setDrawerVisualPosition(
        drawerStagePosition(stage, viewportDrawerWidth()),
        SETTLE_DURATION_MS
      );
    },
    [setDrawerVisualPosition, viewportDrawerWidth]
  );

  // Button, backdrop, Escape, Android back, and menu navigation all continue to
  // drive the stage state; mirror those changes into the same CSS variables
  // used by touch dragging.
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
    velocityThreshold: 0.45,
    shouldStart: target => sidebarOpen || !isInteractiveHorizontalDragStart(target),
    onDragStart: () => {
      dragStartPositionRef.current = drawerStagePosition(drawerStage, viewportDrawerWidth());
      setDrawerVisualPosition(dragStartPositionRef.current, 0);
    },
    onDrag: ({ distance }) => setDrawerVisualPosition(dragStartPositionRef.current + distance, 0),
    onEnd: ({ distance, velocity }) => {
      const nextStage = resolveDrawerStage(
        dragStartPositionRef.current + distance,
        velocity,
        viewportDrawerWidth()
      );
      settleDrawer(nextStage);
      if (nextStage !== drawerStage) setDrawerStage(nextStage);
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
