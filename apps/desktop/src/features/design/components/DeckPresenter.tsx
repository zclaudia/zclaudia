import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import {
  DECK_RATIO_DIMENSIONS,
  filterSlideInPreviewHtml,
  type DeckRatio,
  type DeckSlide,
} from '../deck';

export interface DeckPresenterProps {
  slides: DeckSlide[];
  ratio: DeckRatio;
  /** 已构建的活动页静态预览 HTML；null = 构建中。 */
  previewHtml: string | null;
  startIndex: number;
  onClose: () => void;
}

/**
 * 幻灯片播放覆盖层（P5 §5.2）：挂载即请求全屏（被拒/不支持时静默降级为
 * fixed 黑底覆盖层），卸载退出全屏；window 键盘翻页（←/→/PgUp/PgDn/Space/
 * Home/End/Esc，N 切备注）；幻灯片按比例盒居中并缩放适配容器；底栏含页码、
 * 翻页按钮、备注开关与关闭按钮。播放 HTML 经 filterSlideInPreviewHtml 剥离
 * 全部脚本，翻页由宿主处理，不执行作品脚本。
 */
export function DeckPresenter({
  slides,
  ratio,
  previewHtml,
  startIndex,
  onClose,
}: DeckPresenterProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(() => {
    const last = Math.max(slides.length - 1, 0);
    return Math.min(Math.max(startIndex, 0), last);
  });
  const [notesOpen, setNotesOpen] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  const lastIndex = Math.max(slides.length - 1, 0);
  const current = slides[Math.min(index, lastIndex)];

  // 挂载即请求全屏；浏览器拒绝（或 API 缺失）时静默保持覆盖层形态。卸载时
  // 若仍处于全屏则退出（Escape 关闭路径由 onClose 一并处理）。
  useEffect(() => {
    try {
      rootRef.current?.requestFullscreen?.().catch(() => {});
    } catch {
      // 静默降级为覆盖层。
    }
    return () => {
      if (document.fullscreenElement) {
        try {
          document.exitFullscreen?.().catch(() => {});
        } catch {
          // 静默。
        }
      }
    };
  }, []);

  // 键盘翻页：window 级监听，卸载清理。
  useEffect(() => {
    const last = Math.max(slides.length - 1, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          event.preventDefault();
          setIndex(value => Math.min(value + 1, last));
          break;
        case 'ArrowLeft':
        case 'PageUp':
          event.preventDefault();
          setIndex(value => Math.max(value - 1, 0));
          break;
        case 'Home':
          event.preventDefault();
          setIndex(0);
          break;
        case 'End':
          event.preventDefault();
          setIndex(last);
          break;
        case 'Escape':
          event.preventDefault();
          onClose();
          break;
        case 'n':
        case 'N':
          setNotesOpen(value => !value);
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [slides.length, onClose]);

  // 量测舞台容器以计算缩放（形态对齐 PreviewCanvas 的 ResizeObserver 用法）。
  useEffect(() => {
    const element = stageRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect) setStageSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const dims = DECK_RATIO_DIMENSIONS[ratio];
  const scale =
    stageSize.width > 0 && stageSize.height > 0
      ? Math.min(stageSize.width / dims.width, stageSize.height / dims.height)
      : 1;

  const slideHtml = useMemo(() => {
    if (!previewHtml || !current) return null;
    try {
      return filterSlideInPreviewHtml(previewHtml, current.index);
    } catch {
      return null;
    }
  }, [previewHtml, current]);

  return (
    <div
      ref={rootRef}
      data-testid="deck-presenter"
      className="fixed inset-0 z-50 flex flex-col bg-black"
    >
      <div
        ref={stageRef}
        data-testid="deck-stage"
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
      >
        {slideHtml ? (
          <div
            data-testid="deck-slide-box"
            className="shrink-0 overflow-hidden bg-white"
            style={{
              width: dims.width,
              height: dims.height,
              transform: `scale(${scale})`,
              transformOrigin: 'center center',
            }}
          >
            <iframe
              title={`幻灯片 ${index + 1}`}
              sandbox="allow-scripts"
              srcDoc={slideHtml}
              style={{ width: dims.width, height: dims.height, border: '0' }}
              className="block"
            />
          </div>
        ) : (
          <div role="status" className="text-sm text-muted-foreground">
            正在构建预览…
          </div>
        )}
      </div>
      {notesOpen && current && (
        <div
          data-testid="deck-notes"
          className="max-h-40 overflow-y-auto border-t border-border bg-card px-4 py-2 text-xs text-muted-foreground"
        >
          {current.notes || '无备注'}
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-border bg-card px-3 py-2">
        <span
          data-testid="deck-page-label"
          className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
        >
          {`第 ${index + 1}/${slides.length} 页 · ${current?.title ?? ''}`}
        </span>
        <Button
          size="sm"
          aria-label="上一页"
          disabled={index <= 0}
          onClick={() => setIndex(value => Math.max(value - 1, 0))}
        >
          上一页
        </Button>
        <Button
          size="sm"
          aria-label="下一页"
          disabled={index >= lastIndex}
          onClick={() => setIndex(value => Math.min(value + 1, lastIndex))}
        >
          下一页
        </Button>
        <Button size="sm" aria-label="备注开关" aria-pressed={notesOpen} onClick={() => setNotesOpen(value => !value)}>
          备注
        </Button>
        <Button size="sm" aria-label="关闭演示" onClick={onClose}>
          关闭
        </Button>
      </div>
    </div>
  );
}
