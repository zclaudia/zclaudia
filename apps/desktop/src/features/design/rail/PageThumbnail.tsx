import { useEffect, useRef, useState } from 'react';
import type { DesignPageSnapshot } from '../workspace/controller';

/** 360×240 布局缩放到 54px 列宽（PageOverview 同款配方）。 */
const FRAME_W = 360;
const FRAME_H = 240;
const BOX_W = 54;
const SCALE = BOX_W / FRAME_W;

export interface PageThumbnailProps {
  page: DesignPageSnapshot;
  /** 已构建的预览 srcdoc；undefined = 尚未构建。 */
  preview: string | undefined;
  onRequestPreview: () => void;
}

/**
 * 行内页面缩略图（P4 §4.6）：只在行进入视口（rootMargin 80px，进入即保持）
 * 后才挂 iframe，不可见或未构建时显示灰块。可见且缺预览时请求惰性构建
 * （已请求即去重；预览到位后清标记，缓存被失效清空时允许重新请求）。
 */
export function PageThumbnail({
  page,
  preview,
  onRequestPreview,
}: PageThumbnailProps): JSX.Element {
  const boxRef = useRef<HTMLDivElement | null>(null);
  // 无 IntersectionObserver 的环境（jsdom 测试）：直接视为可见。
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  /** 已发起过预览请求的 path；null = 当前无未决请求。 */
  const requestedRef = useRef<string | null>(null);

  useEffect(() => {
    if (visible) return;
    const box = boxRef.current;
    if (!box || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '80px' }
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [visible]);

  const requestKey = page.draftRevision ? `${page.path}:${page.draftRevision}` : null;

  useEffect(() => {
    if (!visible) return;
    if (preview) {
      requestedRef.current = null;
      return;
    }
    // 文档还没载入时 ensurePreview 会直接返回；这时不能按 path 锁死，否则修订到达后永远是灰块。
    if (!requestKey || requestedRef.current === requestKey) return;
    requestedRef.current = requestKey;
    onRequestPreview();
  }, [visible, preview, requestKey, onRequestPreview]);

  return (
    <div
      ref={boxRef}
      className="h-[38px] w-[54px] shrink-0 overflow-hidden rounded-md border border-border bg-muted"
    >
      {visible && preview ? (
        <iframe
          title={`Page thumbnail ${page.path}`}
          sandbox="allow-scripts"
          srcDoc={preview}
          aria-hidden
          style={{
            width: FRAME_W,
            height: FRAME_H,
            transform: `scale(${SCALE})`,
            transformOrigin: 'top left',
            border: '0',
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </div>
  );
}
