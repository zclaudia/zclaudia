import { useCallback, useEffect, useRef, useState } from 'react';
import { useBottomPanelStore } from '../stores/bottomPanelStore';
import { usePluginStore } from '../stores/pluginStore';
import { useIsMobile } from '../hooks/useMediaQuery';
import { useAndroidBack } from '../hooks/useAndroidBack';
import { PanelActions, PanelContent } from './panels/PanelRenderer';
import { usePanelRegion } from './panels/usePanelRegion';

const MIN_HEIGHT = 100;
const MAX_HEIGHT_VH = 70;
const DEFAULT_HEIGHT_DESKTOP = 300;
const DEFAULT_HEIGHT_MOBILE = 350;
const RESIZE_KEY_STEP_PX = 16;

/**
 * Max panel height in px, derived from the viewport. Shared by `clampHeight`
 * and the resize separator's `aria-valuemax` so the two can't desync.
 */
function getMaxHeightPx(): number {
  return ((typeof window !== 'undefined' ? window.innerHeight : 900) * MAX_HEIGHT_VH) / 100;
}

/** Shared clamp for both the mouse-drag and keyboard resize paths. */
function clampHeight(px: number): number {
  return Math.max(MIN_HEIGHT, Math.min(getMaxHeightPx(), px));
}

interface BottomPanelProps {
  projectId: string | undefined;
  projectRoot: string | undefined;
  workingDirectory?: string;
}

export function BottomPanel({ projectId, projectRoot, workingDirectory }: BottomPanelProps) {
  const isMobile = useIsMobile();
  const activeTab = useBottomPanelStore(s => s.activeTab);
  const setActiveTab = useBottomPanelStore(s => s.setActiveTab);
  const {
    visiblePanels,
    mountedPanels,
    isOpen,
    hasAlwaysMount,
    effectiveTab,
    activePanel,
    showTabs,
  } = usePanelRegion({
    region: 'bottom',
    activeTab,
    isMobile,
    fallbackToActiveTabWhenEmpty: true,
  });

  // Height / drag state
  const containerRef = useRef<HTMLDivElement>(null);
  const [heightPx, setHeightPx] = useState(
    isMobile ? DEFAULT_HEIGHT_MOBILE : DEFAULT_HEIGHT_DESKTOP
  );
  const dragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // Clean up drag listeners if component unmounts mid-drag
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  // Android back to close current panel
  useAndroidBack(
    () => {
      activePanel?.onClose?.();
    },
    isOpen,
    15
  );

  const onDragStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      dragging.current = true;
      startY.current = 'touches' in e ? e.touches[0].clientY : e.clientY;
      startHeight.current = heightPx;

      const onMove = (ev: MouseEvent | TouchEvent) => {
        if (!dragging.current) return;
        const clientY = 'touches' in ev ? ev.touches[0].clientY : ev.clientY;
        const deltaPx = startY.current - clientY;
        setHeightPx(clampHeight(startHeight.current + deltaPx));
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
    [heightPx]
  );

  // Keyboard resize: the handle sits at the top edge of this bottom-anchored
  // panel, so ArrowUp (pulling the edge up) grows it and ArrowDown shrinks
  // it — same direction as dragging. Reuses clampHeight, the same clamp the
  // drag path applies.
  const onResizeKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHeightPx(h => clampHeight(h + RESIZE_KEY_STEP_PX));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHeightPx(h => clampHeight(h - RESIZE_KEY_STEP_PX));
    }
  }, []);

  const handleClose = () => {
    const { updatePanelVisibility } = usePluginStore.getState();
    // Close all visible panels
    visiblePanels.forEach(p => {
      if (p.onClose) {
        p.onClose();
      } else {
        // Generic fallback: hide the panel
        updatePanelVisibility(p.id, false);
      }
    });
  };

  if (!isOpen && !hasAlwaysMount) return null;

  // ── Mobile: full-screen overlay ────────────────────────────────────────────
  if (isMobile && isOpen) {
    return (
      <div className="fixed inset-0 z-40 bg-background flex flex-col safe-top-pad safe-bottom-pad">
        <div className="flex items-center gap-1 px-2 py-2 border-b border-border bg-card flex-shrink-0">
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {showTabs ? (
              <>
                {visiblePanels.map(panel => (
                  <button
                    key={panel.id}
                    onClick={() => setActiveTab(panel.id)}
                    className={`px-2 py-1 rounded-md text-xs font-medium ${
                      effectiveTab === panel.id
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {panel.label}
                  </button>
                ))}
              </>
            ) : (
              <span className="text-sm font-medium text-foreground px-1">
                {activePanel?.label || 'Panel'}
              </span>
            )}
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-0.5">
            {activePanel && <PanelActions panel={activePanel} projectId={projectId} />}
            <button
              onClick={handleClose}
              className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground flex-shrink-0"
              title="Close panel"
              aria-label="Close panel"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden relative">
          {mountedPanels.map(panel => (
            <div
              key={panel.id}
              className={`absolute inset-0 ${effectiveTab === panel.id ? '' : 'invisible'}`}
            >
              <PanelContent
                panel={panel}
                projectId={projectId}
                projectRoot={projectRoot}
                workingDirectory={workingDirectory}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Hidden mount-keeper: this component renders on mobile only (see
  // SessionChatLayout). The mobile overlay above handles the visible case; this
  // height-0 container stays mounted so alwaysMount panels (terminal xterm)
  // keep their state while the overlay is closed.
  return (
    <div
      ref={containerRef}
      className={`flex flex-col flex-shrink-0 bg-card ${isOpen ? 'border-t border-border' : ''}`}
      style={{ height: isOpen ? `${heightPx}px` : '0px', overflow: 'hidden' }}
    >
      {/*
        Resize grip — a dedicated, atomic separator element. ARIA APG forbids
        focusable descendants inside role="separator": it must be a leaf
        widget, not a container for the tabs/actions below. Mouse/touch drag
        lives here too, alongside the keyboard resize handler.
      */}
      <div
        className="group h-1.5 w-full flex-shrink-0 flex items-center justify-center cursor-ns-resize select-none"
        onMouseDown={onDragStart}
        onTouchStart={onDragStart}
        onKeyDown={onResizeKeyDown}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize bottom panel"
        tabIndex={0}
        aria-valuenow={Math.round(heightPx)}
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={Math.round(getMaxHeightPx())}
      >
        <div className="w-8 h-1 rounded-full bg-muted-foreground/0 transition-colors group-hover:bg-muted-foreground/30 group-active:bg-muted-foreground/50" />
      </div>

      {/* Tabs + actions */}
      <div className="flex items-center gap-1 px-2 py-1 select-none border-b border-border flex-shrink-0">
        {/* Tabs */}
        <div
          className="flex items-center gap-0.5 flex-shrink-0"
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
        >
          {showTabs ? (
            <>
              {visiblePanels.map(panel => (
                <button
                  key={panel.id}
                  onClick={() => setActiveTab(panel.id)}
                  className={`px-2 py-0.5 rounded-md text-xs font-medium ${
                    effectiveTab === panel.id
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {panel.label}
                </button>
              ))}
            </>
          ) : (
            <span className="text-xs font-medium text-muted-foreground px-1">
              {activePanel?.label || 'Panel'}
            </span>
          )}
        </div>

        <div className="flex-1" />

        {/* Tab-specific actions */}
        <div
          className="flex items-center gap-0.5"
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
        >
          {activePanel && <PanelActions panel={activePanel} projectId={projectId} />}

          {/* Close button */}
          <button
            onClick={handleClose}
            className="relative p-1 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground flex-shrink-0 before:absolute before:-inset-2 before:content-[''] md:before:content-none"
            title="Hide panel"
            aria-label="Hide panel"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Panel content — alwaysMount panels stay in DOM even when hidden */}
      <div className="flex-1 overflow-hidden relative">
        {mountedPanels.map(panel => (
          <div
            key={panel.id}
            className={`absolute inset-0 ${effectiveTab === panel.id && isOpen ? '' : 'invisible'}`}
          >
            <PanelContent
              panel={panel}
              projectId={projectId}
              projectRoot={projectRoot}
              workingDirectory={workingDirectory}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
