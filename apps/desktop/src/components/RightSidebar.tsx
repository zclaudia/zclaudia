import { useCallback, useEffect, useRef } from 'react';
import { useRightSidebarStore, RIGHT_SIDEBAR_LIMITS } from '../stores/rightSidebarStore';
import { usePluginStore } from '../stores/pluginStore';
import { useSessionToolsStore } from '../stores/sessionToolsStore';
import { useServerStore } from '../stores/serverStore';
import { useIsMobile } from '../hooks/useMediaQuery';
import { PanelActions, PanelContent } from './panels/PanelRenderer';
import { usePanelRegion } from './panels/usePanelRegion';
import { useSplitLayoutStore, isSplitLayout } from '../stores/splitLayoutStore';
import { SplitLayoutView } from './split/SplitLayoutView';
import {
  useDragSplitStore,
  resolvePointerToPane,
  dropZoneToDir,
  canDrop,
  type PanelPayload,
} from './split/dragSplit';
import { getTerminalScopeKey } from '../stores/terminalStore';
import { TOOL_ICONS } from './rightSidebarToolIcons';

interface RightSidebarProps {
  projectId: string | undefined;
  projectRoot: string | undefined;
  workingDirectory?: string;
}

/**
 * Right sidebar — sibling of BottomPanel for desktop.
 * Renders panels whose effective placement is 'right'.
 * Hidden on mobile (mobile uses BottomPanel overlay regardless of placement).
 *
 * Layout state (width, activeTab) is global and persisted in rightSidebarStore.
 * Panel visibility is per-session via pluginStore.panels[*].visible —
 * sidebar collapses when no right-placed panel is visible in the current session.
 */
export function RightSidebar({ projectId, projectRoot, workingDirectory }: RightSidebarProps) {
  const isMobile = useIsMobile();
  const widthFraction = useRightSidebarStore((s) => s.widthFraction);
  const activeTab = useRightSidebarStore((s) => s.activeTab);
  const collapsed = useRightSidebarStore((s) => s.collapsed);
  const setActiveTab = useRightSidebarStore((s) => s.setActiveTab);
  const setWidthFraction = useRightSidebarStore((s) => s.setWidthFraction);
  // Pinned tool tabs (Draft / Files / Changes / Terminal), published by the composer.
  const pinnedTools = useSessionToolsStore((s) => s.tools);
  const {
    visiblePanels,
    mountedPanels,
    isOpen,
    hasAlwaysMount,
    effectiveTab,
    activePanel,
    showTabs,
  } = usePanelRegion({
    region: 'right',
    activeTab,
    isMobile,
  });

  // Width drag state
  const rootRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => { dragCleanupRef.current?.(); };
  }, []);

  const onDragStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = 'touches' in e ? e.touches[0].clientX : e.clientX;
      startWidth.current = widthFraction;

      const onMove = (ev: MouseEvent | TouchEvent) => {
        if (!dragging.current) return;
        const clientX = 'touches' in ev ? ev.touches[0].clientX : ev.clientX;
        // Convert the px drag delta into a fraction of the container width so the
        // panel stays proportional. Handle is on the left edge — moving left widens.
        const container = rootRef.current?.parentElement?.clientWidth || window.innerWidth;
        const deltaPx = startX.current - clientX;
        setWidthFraction(startWidth.current + deltaPx / container);
      };

      const cleanup = () => {
        dragging.current = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        dragCleanupRef.current = null;
      };

      const onUp = () => cleanup();
      dragCleanupRef.current = cleanup;

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove);
      document.addEventListener('touchend', onUp);
    },
    [widthFraction, setWidthFraction],
  );

  const handleClose = () => {
    const { updatePanelVisibility } = usePluginStore.getState();
    visiblePanels.forEach((p) => {
      if (p.onClose) {
        p.onClose();
      } else {
        updatePanelVisibility(p.id, false);
      }
    });
  };

  // --- Split layout integration ----------------------------------------------
  // The layout tree lives in splitLayoutStore. When it is a group, we render the
  // tree (SplitLayoutView) instead of the single-panel overlap layer. The tree is
  // lazily seeded with a single pane the first time a panel becomes visible.
  const hasPinned = pinnedTools.length > 0;
  // `collapsed` hides the sidebar without unmounting — alwaysMount panels (terminal
  // xterm) keep their state while the user has it tucked away. Computed before the
  // early returns so the split hooks below can depend on it.
  const expanded = !collapsed && (isOpen || hasPinned);

  const splitRoot = useSplitLayoutStore((s) => s.root);
  const splitContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Seed a single-pane tree when a panel is visible and no tree exists yet.
    if (!expanded) return;
    if (splitRoot || !effectiveTab) return;
    useSplitLayoutStore.getState().initSingle(effectiveTab);
  }, [expanded, splitRoot, effectiveTab]);

  const activeServerId = useServerStore((s) => s.activeServerId);

  /** Build the drag payload for a panel tab (terminal carries its scope key). */
  const buildPayload = useCallback(
    (panelId: string): PanelPayload => {
      if (panelId === 'terminal' && projectId) {
        return { panelId, instanceKey: getTerminalScopeKey(projectId, activeServerId) };
      }
      return { panelId };
    },
    [projectId, activeServerId],
  );

  const onPanelTabPointerDown = useCallback(
    (panelId: string, e: React.PointerEvent) => {
      // Only start a drag on a primary-button press; let a plain click switch tabs.
      if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) return;
      useDragSplitStore.getState().startDrag(buildPayload(panelId));
    },
    [buildPayload],
  );

  /** Track hover zone while a drag is over the content area. */
  const onContentPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const { active } = useDragSplitStore.getState();
      if (!active) return;
      const hit = resolvePointerToPane(
        splitContentRef.current,
        useSplitLayoutStore.getState().root,
        e.clientX,
        e.clientY,
        active,
      );
      useDragSplitStore.getState().setHover(hit?.paneId ?? null, hit?.zone ?? null, hit?.disabled ?? new Set());
    },
    [],
  );

  /** On drop: split or replace per the resolved zone; always end the drag. */
  const onContentPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const { active } = useDragSplitStore.getState();
      if (!active) {
        return;
      }
      const hit = resolvePointerToPane(
        splitContentRef.current,
        useSplitLayoutStore.getState().root,
        e.clientX,
        e.clientY,
        active,
      );
      if (hit) {
        const { panelId, instanceKey } = active;
        const splitInfo = dropZoneToDir(hit.zone);
        if (splitInfo) {
          const ok = canDrop(
            useSplitLayoutStore.getState().root,
            hit.paneId,
            hit.zone,
            active,
          ).allowed;
          if (ok) {
            useSplitLayoutStore.getState().split(hit.paneId, splitInfo.dir, panelId, instanceKey);
          }
        } else {
          // center → replace the pane's panel
          useSplitLayoutStore.getState().replacePane(hit.paneId, panelId, instanceKey);
        }
      }
      useDragSplitStore.getState().endDrag();
    },
    [],
  );

  // End any in-flight drag if the sidebar collapses.
  useEffect(() => {
    if (!expanded) useDragSplitStore.getState().endDrag();
  }, [expanded]);

  if (isMobile) return null;
  if (!isOpen && !hasAlwaysMount && !hasPinned) return null;

  return (
    <div
      ref={rootRef}
      className={`flex flex-col flex-shrink-0 bg-card ${expanded ? 'border-l border-border' : ''} relative`}
      style={{
        // Width is a fraction of the container so it scales with the window; the
        // browser keeps the ratio on resize, with a px floor and a max share cap.
        width: expanded ? `${widthFraction * 100}%` : '0px',
        minWidth: expanded ? `${RIGHT_SIDEBAR_LIMITS.MIN_WIDTH_PX}px` : undefined,
        maxWidth: expanded ? `${RIGHT_SIDEBAR_LIMITS.MAX_WIDTH_FRACTION * 100}%` : undefined,
        overflow: 'hidden',
        contain: 'layout paint style',
      }}
    >
      {/* Drag handle on left edge */}
      {expanded && (
        <div
          className="absolute top-0 left-0 w-1 h-full cursor-ew-resize hover:bg-muted z-10"
          onMouseDown={onDragStart}
          onTouchStart={onDragStart}
        />
      )}

      {/* Header: tabs + actions */}
      <div
        className="flex min-h-9 items-center gap-1 px-2 py-1 select-none border-b border-border flex-shrink-0"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-0.5 flex-shrink-0 min-w-0 overflow-hidden">
          {hasPinned ? (
            pinnedTools.map((tool) => {
              const Icon = TOOL_ICONS[tool.iconKey];
              return (
                <button
                  key={tool.id}
                  onClick={tool.onClick}
                  title={tool.label}
                  aria-label={tool.label}
                  aria-pressed={tool.isActive}
                  className={`relative flex h-7 w-7 items-center justify-center rounded-md ${
                    tool.isActive
                      ? 'bg-secondary text-primary'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  {Icon ? <Icon size={15} strokeWidth={1.75} /> : null}
                  {tool.hasBadge && (
                    <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />
                  )}
                </button>
              );
            })
          ) : showTabs ? (
            visiblePanels.map((panel) => (
              <button
                key={panel.id}
                onClick={() => setActiveTab(panel.id)}
                onPointerDown={(e) => onPanelTabPointerDown(panel.id, e)}
                className={`px-2 py-0.5 rounded-md text-xs font-medium cursor-grab active:cursor-grabbing ${
                  effectiveTab === panel.id
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title={`Drag ${panel.label} to split, or click to switch`}
              >
                {panel.label}
              </button>
            ))
          ) : (
            <span className="text-xs font-medium text-muted-foreground px-1 truncate">
              {activePanel?.label || 'Panel'}
            </span>
          )}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-0.5 flex-shrink-0">
          {activePanel && <PanelActions panel={activePanel} projectId={projectId} />}

          <button
            onClick={handleClose}
            className="p-1 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            title="Hide panel"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content — alwaysMount panels stay in DOM even when hidden.
          When the split layout tree has a group, render the tree (two+ panes)
          instead of the single-panel overlap layer. */}
      <div
        ref={splitContentRef}
        className="flex-1 overflow-hidden relative [contain:layout_paint]"
        onPointerMove={onContentPointerMove}
        onPointerUp={onContentPointerUp}
      >
        {isSplitLayout(splitRoot) ? (
          <>
            <SplitLayoutView
              projectId={projectId}
              projectRoot={projectRoot}
              workingDirectory={workingDirectory}
            />
            {/* Drop overlays are rendered per-pane inside PaneView; the active-drag
                indicator lives here. */}
          </>
        ) : (
          mountedPanels.map((panel) => (
            <div key={panel.id} className={`absolute inset-0 ${effectiveTab === panel.id && expanded ? '' : 'invisible'}`}>
              <PanelContent panel={panel} projectId={projectId} projectRoot={projectRoot} workingDirectory={workingDirectory} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
