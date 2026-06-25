import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useRightSidebarStore, RIGHT_SIDEBAR_LIMITS } from '../stores/rightSidebarStore';
import { useRightWorkspaceStore } from '../stores/rightWorkspaceStore';
import { useIsMobile } from '../hooks/useMediaQuery';
import { WorkspaceView } from './workspace/WorkspaceView';
import { RightSidebarEmptyState } from './RightSidebarEmptyState';
import { ToolLauncherMenu } from './workspace/ToolLauncherMenu';

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
  const [launcherOpen, setLauncherOpen] = useState(false);

  // Ensure a workspace entry exists for this session (no-op if present).
  useEffect(() => { useRightWorkspaceStore.getState().ensureSession(sessionId); }, [sessionId]);

  const rootRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // Cleanup drag listeners on unmount to avoid document-listener leak.
  useEffect(() => () => { dragCleanupRef.current?.(); }, []);

  // Outside-click dismissal for the launcher menu.
  const launcherContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!launcherOpen) return;
    const handler = (e: MouseEvent) => {
      if (launcherContainerRef.current && !launcherContainerRef.current.contains(e.target as Node)) {
        setLauncherOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [launcherOpen]);

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

      <div className="flex min-h-9 items-center gap-1 px-2 py-1 select-none border-b border-border flex-shrink-0" data-tauri-drag-region>
        <span className="text-xs font-medium text-muted-foreground px-1">Workspace</span>
        <div className="flex-1" />
        <div className="relative" ref={launcherContainerRef}>
          <button
            onClick={() => setLauncherOpen((v) => !v)}
            title="Add tool"
            aria-label="Add tool"
            className="p-1 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          {launcherOpen && (
            <ToolLauncherMenu
              sessionId={sessionId}
              projectId={projectId}
              onPick={() => setLauncherOpen(false)}
            />
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative [contain:layout_paint]">
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
