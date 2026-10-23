import { useEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import type { DesignViewport, DesignZoom } from '../types';

export interface PreviewCanvasProps {
  /** 构建好的预览 srcdoc（空串时显示空文档占位）。 */
  srcDoc: string;
  viewport: DesignViewport;
  zoom: DesignZoom;
  /** 面板持有 iframe 引用：message 事件按 event.source 校验、onLoad 发 verify。 */
  frameRef?: Ref<HTMLIFrameElement>;
  /** iframe load 回调（面板在此发送 verify 请求，保证到达重建后的预览）。 */
  onFrameLoad?: () => void;
  className?: string;
}

const EMPTY_HTML = '<!doctype html><html><body></body></html>';

/**
 * 受视口/缩放控制的预览画布（P2 §3）。iframe 布局宽度只由视口决定；
 * scale 是纯显示变换（fit 模式 = min(1, 容器宽 / frameW)），经外层占位
 * div 撑开滚动尺寸。preset 'fill' 时 iframe 铺满容器且恒定 scale 1。
 */
export function PreviewCanvas({
  srcDoc,
  viewport,
  zoom,
  frameRef,
  onFrameLoad,
  className = '',
}: PreviewCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect) setContainerSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fill = viewport.preset === 'fill';
  const frameWidthPx = fill ? null : (viewport.width ?? 0);
  // 缩放只影响显示：fill 恒 1（控件禁用）；fit 随容器宽度自适应；manual 取值。
  const scale = fill
    ? 1
    : zoom.mode === 'manual'
      ? zoom.value
      : frameWidthPx && containerSize.width > 0
        ? Math.min(1, containerSize.width / frameWidthPx)
        : 1;
  const frameW = fill ? '100%' : `${frameWidthPx}px`;
  const placeholderW = fill
    ? '100%'
    : `${Math.round((frameWidthPx ?? 0) * scale * 100) / 100}px`;
  const frameH = '100%';

  return (
    <div
      ref={containerRef}
      data-testid="design-canvas"
      className={`min-h-52 flex-1 overflow-auto bg-background ${className}`.trim()}
    >
      <div
        data-testid="design-canvas-placeholder"
        style={{
          width: placeholderW,
          height: '100%',
          minWidth: '100%',
        }}
      >
        <iframe
          ref={frameRef}
          title="设计预览"
          sandbox="allow-scripts"
          srcDoc={srcDoc || EMPTY_HTML}
          onLoad={onFrameLoad}
          style={{
            width: frameW,
            height: frameH,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            border: '0',
          }}
          className="block bg-white"
        />
      </div>
    </div>
  );
}
