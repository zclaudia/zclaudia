import { useEffect } from 'react';
import { useFileViewerStore } from '../../../stores/fileViewerStore';
import { useWorkspaceTool } from '../../../components/workspace/WorkspaceToolContext';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import type { DesignPageSnapshot } from '../workspace/controller';

export interface PageOverviewProps {
  pages: DesignPageSnapshot[];
  activePath: string | null;
  /** path → 已构建的预览 srcdoc（缺失表示尚未构建）。 */
  previews: Record<string, string>;
  /** 对还没有预览串的页面请求惰性构建（面板侧并发 ≤2，复用共享缓存）。 */
  onRequestPreview: (page: DesignPageSnapshot) => void;
  onActivate: (path: string) => void;
}

const FRAME_W = 360;
const FRAME_H = 240;
const DISPLAY_W = 160;
const SCALE = DISPLAY_W / FRAME_W;
const DISPLAY_H = Math.round(FRAME_H * SCALE);

const EMPTY_HTML = '<!doctype html><html><body></body></html>';
const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1) || path;

/**
 * 页面总览（P2 §7）：打开页网格，每格 mini iframe（360×240 布局缩放到显示
 * 宽约 160，pointer-events:none）+ basename + 脏/缺失徽标；点击卡片激活页面，
 * 「在查看器中打开」走 fileViewerStore（fileViewer 永远显示磁盘内容）。
 */
export function PageOverview({
  pages,
  activePath,
  previews,
  onRequestPreview,
  onActivate,
}: PageOverviewProps) {
  const tool = useWorkspaceTool();

  // 非活动页惰性构建：渲染时对缺预览的页面发起请求（并发上限在面板侧队列）。
  useEffect(() => {
    for (const page of pages) {
      if (!previews[page.path]) onRequestPreview(page);
    }
  }); // 每次渲染后检查：previews 随构建完成逐格补充。

  const openInViewer = (path: string) => {
    useFileViewerStore.getState().openFile(
      tool?.projectRoot ?? '',
      path,
      undefined,
      undefined,
      tool?.backendId
    );
  };

  return (
    <div
      data-testid="design-overview"
      className="min-h-52 flex-1 overflow-y-auto bg-background p-3"
    >
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2">
        {pages.map(page => (
          <li key={page.path}>
            <div
              role="button"
              tabIndex={0}
              aria-label={`Activate ${page.path}`}
              aria-pressed={page.path === activePath}
              onClick={() => onActivate(page.path)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') onActivate(page.path);
              }}
              className={`flex cursor-pointer flex-col gap-1 rounded-md border p-1.5 transition-colors ${
                page.path === activePath
                  ? 'border-primary/50 bg-primary/5'
                  : 'border-border hover:bg-secondary'
              }`}
            >
              <div
                className="overflow-hidden rounded border border-border bg-white"
                style={{ width: DISPLAY_W, height: DISPLAY_H }}
              >
                <iframe
                  title={`Page thumbnail ${page.path}`}
                  sandbox="allow-scripts"
                  srcDoc={previews[page.path] || EMPTY_HTML}
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
              </div>
              <div className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-[11px]" title={page.path}>
                  {basename(page.path)}
                </span>
                {page.status === 'dirty' && <Badge label="Unsaved" tone="accent" />}
                {page.missing && <Badge label="Missing" tone="neutral" />}
              </div>
              <Button
                size="sm"
                aria-label={`Open in viewer ${page.path}`}
                onClick={() => openInViewer(page.path)}
              >
                Open in viewer
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {pages.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No page open yet; choose a file from "Open page" first.
        </p>
      )}
    </div>
  );
}
