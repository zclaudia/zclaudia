import { useCallback, useEffect, useRef } from 'react';
import { useRightSidebarStore, RIGHT_SIDEBAR_LIMITS } from '../stores/rightSidebarStore';
import { useRightWorkspaceStore, findPaneWithTool } from '../stores/rightWorkspaceStore';
import { useIsMobile } from '../hooks/useMediaQuery';
import { WorkspaceView } from './workspace/WorkspaceView';
import { RightSidebarEmptyState } from './RightSidebarEmptyState';
import { useDragSplitStore, resolvePointerToPane, resolveTabDrop, dropZoneToDir } from './workspace/dragSplit';

interface RightSidebarProps {
  sessionId: string;
  projectId: string | undefined;
  projectRoot: string | undefined;
  workingDirectory?: string;
}

export function RightSidebar({ sessionId, projectId, projectRoot, workingDirectory }: RightSidebarProps) {
  const isMobile = useIsMobile();
  const widthFraction = useRightSidebarStore((s) => s.widthFraction);
  const collapsed = useRightSidebarStore((s) => s.collapsed);
  const setWidthFraction = useRightSidebarStore((s) => s.setWidthFraction);

  const root = useRightWorkspaceStore((s) => s.bySession[sessionId]?.root ?? null);

  // Ensure a workspace entry exists for this session (no-op if present).
  useEffect(() => { useRightWorkspaceStore.getState().ensureSession(sessionId); }, [sessionId]);

  // End any in-flight drag when the sidebar collapses.
  useEffect(() => { if (collapsed) useDragSplitStore.getState().endDrag(); }, [collapsed]);
  // End any in-flight drag on unmount.
  useEffect(() => () => { useDragSplitStore.getState().endDrag(); }, []);

  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // Cleanup drag listeners on unmount to avoid document-listener leak.
  useEffect(() => () => { dragCleanupRef.current?.(); }, []);

  const onContentPointerMove = useCallback((e: React.PointerEvent) => {
    const { active } = useDragSplitStore.getState();
    if (!active) return;
    const tab = resolveTabDrop(contentRef.current, e.clientX, e.clientY);
    if (tab) {
      useDragSplitStore.getState().setTabHover(tab.paneId, tab.index);
      useDragSplitStore.getState().setHover(null, null, new Set());
      return;
    }
    useDragSplitStore.getState().setTabHover(null, null);
    const root = useRightWorkspaceStore.getState().bySession[sessionId]?.root ?? null;
    const hit = resolvePointerToPane(contentRef.current, root, e.clientX, e.clientY, active);
    useDragSplitStore.getState().setHover(hit?.paneId ?? null, hit?.zone ?? null, hit?.disabled ?? new Set());
  }, [sessionId]);

  const onContentPointerUp = useCallback((e: React.PointerEvent) => {
    const store = useRightWorkspaceStore.getState();
    const { active } = useDragSplitStore.getState();
    if (!active) return;

    // 1) Drop over a tab strip → reorder (same pane) or move (different pane).
    const tab = resolveTabDrop(contentRef.current, e.clientX, e.clientY);
    if (tab) {
      if (active.sourcePaneId === tab.paneId && active.sourceIndex !== undefined) {
        const to = tab.index > active.sourceIndex ? tab.index - 1 : tab.index;
        store.reorderTab(sessionId, tab.paneId, active.sourceIndex, to);
      } else if (active.sourcePaneId) {
        store.moveTab(sessionId, active.sourcePaneId, tab.paneId, active.toolId, active.instanceKey, tab.index);
      }
      useDragSplitStore.getState().endDrag();
      return;
    }

    // 2) Drop over a pane edge/center.
    const root = store.bySession[sessionId]?.root ?? null;
    const hit = resolvePointerToPane(contentRef.current, root, e.clientX, e.clientY, active);
    if (hit && active.sourcePaneId) {
      const split = dropZoneToDir(hit.zone);
      if (split) {
        if (hit.paneId === active.sourcePaneId) {
          store.splitTabOut(sessionId, active.sourcePaneId, active.toolId, active.instanceKey, split.dir, split.insertFirst);
        } else {
          store.moveTab(sessionId, active.sourcePaneId, hit.paneId, active.toolId, active.instanceKey);
          const after = useRightWorkspaceStore.getState().bySession[sessionId]?.root ?? null;
          const destPaneId = findPaneWithTool(after, active.toolId, active.instanceKey, !active.multiInstance);
          if (destPaneId) store.splitTabOut(sessionId, destPaneId, active.toolId, active.instanceKey, split.dir, split.insertFirst);
        }
      } else {
        store.moveTab(sessionId, active.sourcePaneId, hit.paneId, active.toolId, active.instanceKey);
      }
    }
    useDragSplitStore.getState().endDrag();
  }, [sessionId]);

  const onDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = 'touches' in e ? e.touches[0].clientX : e.clientX;
    startWidth.current = widthFraction;
    const onMove = (ev: MouseEvent | TouchEvent) => {
      if (!dragging.current) return;
      const clientX = 'touches' in ev ? ev.touches[0].clientX : ev.clientX;
      const container = rootRef.current?.parentElement?.clientWidth || window.innerWidth;
      setWidthFraction(startWidth.current + (startX.current - clientX) / container);
    };
    const cleanup = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', cleanup);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', cleanup);
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current = cleanup;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', cleanup);
    document.addEventListener('touchmove', onMove);
    document.addEventListener('touchend', cleanup);
  }, [widthFraction, setWidthFraction]);

  if (isMobile) return null;
  if (collapsed) return null;

  return (
    <div
      ref={rootRef}
      className="flex flex-col flex-shrink-0 bg-card border-l border-border relative"
      style={{
        width: `${widthFraction * 100}%`,
        minWidth: `${RIGHT_SIDEBAR_LIMITS.MIN_WIDTH_PX}px`,
        maxWidth: `${RIGHT_SIDEBAR_LIMITS.MAX_WIDTH_FRACTION * 100}%`,
        overflow: 'hidden',
        contain: 'layout paint style',
      }}
    >
      <div
        className="absolute top-0 left-0 w-1 h-full cursor-ew-resize hover:bg-muted z-10"
        onMouseDown={onDragStart}
        onTouchStart={onDragStart}
      />

      <div
        ref={contentRef}
        className="flex-1 overflow-hidden relative [contain:layout_paint]"
        onPointerMove={onContentPointerMove}
        onPointerUp={onContentPointerUp}
      >
        {root != null ? (
          <WorkspaceView sessionId={sessionId} projectId={projectId} projectRoot={projectRoot} workingDirectory={workingDirectory} />
        ) : (
          <div className="absolute inset-0">
            <RightSidebarEmptyState sessionId={sessionId} projectId={projectId} projectRoot={projectRoot} />
          </div>
        )}
      </div>
    </div>
  );
}
