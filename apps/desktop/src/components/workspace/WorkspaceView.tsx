import { useCallback, useEffect, useRef, useState } from 'react';
import { useRightWorkspaceStore, type LayoutNode, type GroupNode } from '../../stores/rightWorkspaceStore';
import { PaneView } from './PaneView';

interface WorkspaceViewProps {
  sessionId: string;
  projectId?: string;
  projectRoot?: string;
  workingDirectory?: string;
}

export function WorkspaceView({ sessionId, projectId, projectRoot, workingDirectory }: WorkspaceViewProps) {
  const root = useRightWorkspaceStore((s) => s.bySession[sessionId]?.root ?? null);
  const focusedPaneId = useRightWorkspaceStore((s) => s.bySession[sessionId]?.focusedPaneId ?? null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const renderNode = useCallback(
    (node: LayoutNode): React.ReactNode => {
      if (node.kind === 'pane') {
        return (
          <PaneView
            key={node.id}
            sessionId={sessionId}
            paneId={node.id}
            focused={focusedPaneId === node.id}
            projectId={projectId}
            projectRoot={projectRoot}
            workingDirectory={workingDirectory}
          />
        );
      }
      return renderGroup(node);
    },
    [focusedPaneId, projectId, projectRoot, workingDirectory, sessionId],
  );

  const renderGroup = (group: GroupNode): React.ReactNode => {
    const isRow = group.dir === 'row';
    return (
      <div
        key={group.id}
        className={isRow ? 'flex flex-row min-w-0 min-h-0' : 'flex flex-col min-w-0 min-h-0'}
        style={{ flex: '1 1 0%', minWidth: 0, minHeight: 0 }}
      >
        <div style={{ flex: `${group.ratio} 1 0%`, minWidth: 0, minHeight: 0 }}>{renderNode(group.children[0])}</div>
        <div className={isRow ? 'w-px bg-border flex-shrink-0' : 'h-px bg-border flex-shrink-0'} />
        <div style={{ flex: `${1 - group.ratio} 1 0%`, minWidth: 0, minHeight: 0 }}>{renderNode(group.children[1])}</div>
      </div>
    );
  };

  if (!root) return null;
  return (
    <div ref={containerRef} className="flex flex-1 min-w-0 min-h-0">
      {renderNode(root)}
    </div>
  );
}
