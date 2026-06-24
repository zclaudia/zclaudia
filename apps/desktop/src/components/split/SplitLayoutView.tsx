import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useSplitLayoutStore,
  type LayoutNode,
  type GroupNode,
} from '../../stores/splitLayoutStore';
import { PaneView } from './PaneView';
import { ResizeDivider } from './ResizeDivider';

interface SplitLayoutViewProps {
  projectId?: string;
  projectRoot?: string;
  workingDirectory?: string;
}

/**
 * Recursive renderer for the split layout tree.
 *
 * - A PaneNode renders a single <PaneView> filling its slot.
 * - A GroupNode renders a flex row/column: first child, a ResizeDivider, second child.
 *   The group's `ratio` is applied as the first child's flex-grow (the second
 *   grows by `1 - ratio`); a px floor keeps each pane usable.
 *
 * The root container measures its own size via a ResizeObserver so ResizeDividers
 * get a real `containerSize` for ratio math. Nothing renders when root is null.
 */
export function SplitLayoutView({ projectId, projectRoot, workingDirectory }: SplitLayoutViewProps) {
  const root = useSplitLayoutStore((s) => s.root);
  const focusedPaneId = useSplitLayoutStore((s) => s.focusedPaneId);
  const setRatio = useSplitLayoutStore((s) => s.setRatio);

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

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
    [focusedPaneId, projectId, projectRoot, workingDirectory],
  );

  const renderGroup = (group: GroupNode): React.ReactNode => {
    const isRow = group.dir === 'row';
    const containerSize = isRow ? size.width : size.height;
    const firstFlex = group.ratio;
    const secondFlex = 1 - group.ratio;
    return (
      <div
        key={group.id}
        className={isRow ? 'flex flex-row min-w-0 min-h-0' : 'flex flex-col min-w-0 min-h-0'}
        style={{ flex: '1 1 0%', minWidth: 0, minHeight: 0 }}
      >
        <div style={{ flex: `${firstFlex} 1 0%`, minWidth: 0, minHeight: 0 }}>
          {renderNode(group.children[0])}
        </div>
        <ResizeDivider
          groupId={group.id}
          dir={group.dir}
          containerSize={containerSize}
          onDrag={(delta) => setRatio(group.id, group.ratio + delta)}
        />
        <div style={{ flex: `${secondFlex} 1 0%`, minWidth: 0, minHeight: 0 }}>
          {renderNode(group.children[1])}
        </div>
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
