import { useMemo } from 'react';
import { LayoutGrid, MoreHorizontal, Plus } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { DropdownMenu } from '../../../components/ui/DropdownMenu';
import { IconButton } from '../../../components/ui/Button';
import { TONE_DOT } from '../../../components/ui/tone';
import type { DesignPageSnapshot } from '../workspace/controller';
import { PageThumbnail } from './PageThumbnail';

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1) || path;

export interface PagesViewProps {
  pages: DesignPageSnapshot[];
  activePath: string | null;
  /** 工作区全部 HTML 文件；未打开的进入「Not open」分组。 */
  files: string[];
  /** path → 已构建的预览 srcdoc（缺失表示尚未构建）。 */
  previews: Record<string, string>;
  overviewOpen: boolean;
  onActivate: (path: string) => void;
  /** 关闭请求：dirty 页由面板先弹确认框。 */
  onClose: (path: string) => void;
  onOpen: (path: string) => void;
  onOpenTemplates: () => void;
  onToggleOverview: () => void;
  /** 经 fileViewer 打开磁盘文件（fileViewer 永远显示磁盘内容）。 */
  onOpenInViewer: (path: string) => void;
  /** 对还没有预览串的页面请求惰性构建（并发上限在面板侧队列）。 */
  onRequestPreview: (page: DesignPageSnapshot) => void;
}

/**
 * 左栏 Pages 视图（P4 §4.6）：已打开页的缩略图行（点击激活、脏点 / Missing
 * 徽标、行 `⋯` 菜单 = Open in viewer / Close）+ 下方「Not open」分组列出未
 * 打开文件（取代 Open page 下拉）；头部为模板入口（+）与总览开关（Grid）。
 */
export function PagesView({
  pages,
  activePath,
  files,
  previews,
  overviewOpen,
  onActivate,
  onClose,
  onOpen,
  onOpenTemplates,
  onToggleOverview,
  onOpenInViewer,
  onRequestPreview,
}: PagesViewProps): JSX.Element {
  const notOpen = useMemo(() => {
    const open = new Set(pages.map(page => page.path));
    return files.filter(path => !open.has(path));
  }, [pages, files]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 bg-background/40 px-2">
        <span className="flex-1" />
        <IconButton size="sm" aria-label="New page from template" onClick={onOpenTemplates}>
          <Plus size={12} strokeWidth={1.75} />
        </IconButton>
        <IconButton
          size="sm"
          aria-label="Overview"
          aria-pressed={overviewOpen}
          onClick={onToggleOverview}
        >
          <LayoutGrid size={12} strokeWidth={1.75} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {pages.length === 0 && (
          <p className="px-1 py-1 text-[11px] text-muted-foreground">No page open yet.</p>
        )}
        <ul>
          {pages.map(page => {
            const active = page.path === activePath;
            return (
              <li
                key={page.path}
                className="flex items-center gap-0.5 rounded-md pr-0.5 transition-colors hover:bg-secondary"
              >
                <button
                  type="button"
                  aria-label={`Activate ${page.path}`}
                  aria-current={active ? 'page' : undefined}
                  title={page.path}
                  onClick={() => onActivate(page.path)}
                  className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md p-1 text-left text-[11px] text-foreground transition-colors ${
                    active ? 'bg-primary/5' : ''
                  }`}
                >
                  <PageThumbnail
                    page={page}
                    preview={previews[page.path]}
                    onRequestPreview={() => onRequestPreview(page)}
                  />
                  <span className="min-w-0 flex-1 truncate">{basename(page.path)}</span>
                  {page.status === 'dirty' && (
                    <span
                      aria-hidden
                      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT.warning}`}
                    />
                  )}
                  {page.missing && <Badge label="Missing" tone="neutral" />}
                </button>
                <DropdownMenu
                  ariaLabel={`Page actions ${page.path}`}
                  align="end"
                  entries={[
                    {
                      key: 'open-in-viewer',
                      label: 'Open in viewer',
                      onSelect: () => onOpenInViewer(page.path),
                    },
                    { key: 'close', label: 'Close', onSelect: () => onClose(page.path) },
                  ]}
                  trigger={({ ref, props }) => (
                    <IconButton
                      {...props}
                      ref={ref}
                      size="sm"
                      aria-label={`Page actions ${page.path}`}
                    >
                      <MoreHorizontal size={12} strokeWidth={1.75} />
                    </IconButton>
                  )}
                />
              </li>
            );
          })}
        </ul>
        {notOpen.length > 0 && (
          <section className="mt-2">
            <p className="px-1 py-0.5 text-[10px] text-muted-foreground">Not open</p>
            <ul>
              {notOpen.map(path => (
                <li key={path}>
                  <button
                    type="button"
                    aria-label={`Open ${path}`}
                    title={path}
                    onClick={() => onOpen(path)}
                    className="w-full truncate rounded-md px-1 py-1 text-left font-mono text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    {path}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
