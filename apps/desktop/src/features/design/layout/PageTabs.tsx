import { useMemo } from 'react';
import { Plus, TriangleAlert, X } from 'lucide-react';
import { IconButton } from '../../../components/ui/Button';
import { DropdownMenu } from '../../../components/ui/DropdownMenu';
import { TONE_DOT } from '../../../components/ui/tone';
import { Tooltip } from '../../../components/ui/Tooltip';
import type { DesignPageSnapshot } from '../workspace/controller';

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1) || path;

export interface PageTabsProps {
  pages: DesignPageSnapshot[];
  activePath: string | null;
  /** 工作区全部 HTML 文件；未打开的进入 `+` 菜单。 */
  files: string[];
  onActivate: (path: string) => void;
  /** 关闭请求：dirty 页由面板先弹确认框（保存 / 放弃修改 / 取消）。 */
  onClose: (path: string) => void;
  /** 打开未打开的文件；失败提示由面板推入通知栈。 */
  onOpen: (path: string) => void;
  /** 窄档只显示当前页签（mockup 的 tab:not(.on) 收纳）。 */
  showOnlyActive?: boolean;
}

/**
 * 顶栏页签（P1 §4.1）：标签 = 脏点 + basename + 关闭；缺失页用 TriangleAlert。
 * `+` 是 DropdownMenu，列出未打开的文件（取代原「Open page」下拉）。
 */
export function PageTabs({
  pages,
  activePath,
  files,
  onActivate,
  onClose,
  onOpen,
  showOnlyActive = false,
}: PageTabsProps) {
  const unopened = useMemo(() => {
    const open = new Set(pages.map(page => page.path));
    return files.filter(path => !open.has(path));
  }, [pages, files]);

  return (
    <div className="flex min-w-0 items-center gap-1">
      <div
        role="tablist"
        aria-label="Design pages"
        className="flex min-w-0 items-center gap-0.5 overflow-x-auto"
      >
        {pages.map(page => {
          const active = page.path === activePath;
          if (showOnlyActive && !active) return null;
          return (
            <div
              key={page.path}
              className={`group flex h-7 shrink-0 items-center gap-0.5 rounded-md pl-2 pr-0.5 text-[11px] transition-colors ${
                active
                  ? 'bg-secondary font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                title={page.path}
                onClick={() => onActivate(page.path)}
                className="flex min-w-0 items-center gap-1 outline-none"
              >
                {page.status === 'dirty' && (
                  <span
                    aria-hidden
                    data-testid={`dirty-dot-${page.path}`}
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT.warning}`}
                  />
                )}
                <span className="max-w-40 truncate">{basename(page.path)}</span>
                {page.missing && (
                  <TriangleAlert
                    size={11}
                    strokeWidth={1.75}
                    aria-label={`Missing file ${page.path}`}
                    className="shrink-0 text-warning"
                  />
                )}
              </button>
              <Tooltip content="Close page">
                <IconButton
                  size="sm"
                  aria-label={`Close ${page.path}`}
                  onClick={() => onClose(page.path)}
                  className={`h-5 w-5 transition-opacity ${
                    active ? 'opacity-70' : 'opacity-0 group-hover:opacity-70'
                  }`}
                >
                  <X size={11} strokeWidth={1.75} />
                </IconButton>
              </Tooltip>
            </div>
          );
        })}
      </div>
      <DropdownMenu
        ariaLabel="Open page"
        align="start"
        entries={
          unopened.length === 0
            ? [
                {
                  key: 'empty',
                  label: 'No unopened files',
                  onSelect: () => undefined,
                  disabled: true,
                },
              ]
            : unopened.map(path => ({ key: path, label: path, onSelect: () => onOpen(path) }))
        }
        trigger={({ ref, props }) => (
          <Tooltip content="Open a page">
            <IconButton
              {...props}
              ref={ref}
              size="sm"
              aria-label="Open page"
              disabled={unopened.length === 0}
            >
              <Plus size={13} strokeWidth={1.75} />
            </IconButton>
          </Tooltip>
        )}
      />
    </div>
  );
}
