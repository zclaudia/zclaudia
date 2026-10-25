import { useElementTier } from '../hooks/useElementTier';
import { ViewportBar } from './ViewportBar';
import type { ViewportBarProps } from './ViewportBar';

export interface CanvasToolbarProps extends ViewportBarProps {
  /** 显式紧凑模式（测试/极窄宿主）；缺省按工具栏实测宽度决定。 */
  compact?: boolean;
}

/**
 * 画布上方工具栏（设计工作台布局收敛）：视口/缩放从顶栏移到预览舞台正上方。
 * 只复用 ViewportBar 的控件与回调，不复制宽度校验或缩放逻辑；极窄容器下
 * 由 ViewportBar 隐藏 Custom width，避免设备/缩放两组控件挤出画布。
 */
export function CanvasToolbar({ compact: compactProp, ...viewportProps }: CanvasToolbarProps) {
  const { ref, compact: measuredCompact } = useElementTier<HTMLDivElement>();
  const compact = Boolean(compactProp) || measuredCompact;

  return (
    <div
      ref={ref}
      data-testid="design-canvas-toolbar"
      role="toolbar"
      aria-label="Canvas toolbar"
      className="flex h-10 shrink-0 items-center overflow-hidden border-b border-border bg-background/60 px-2.5"
    >
      <ViewportBar {...viewportProps} compact={compact} />
    </div>
  );
}
