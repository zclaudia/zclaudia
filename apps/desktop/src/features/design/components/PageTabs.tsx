import { useMemo, useState } from 'react';
import { Select } from '../../../components/ui/Select';
import type { DesignPageSnapshot, OpenPageResult } from '../workspace/controller';

/** open 失败的用户提示：limit 是既定文案，其余透出控制器返回的 message。 */
const openFailureMessage = (result: Extract<OpenPageResult, { ok: false }>): string =>
  result.reason === 'limit' ? '先关闭未保存的页面' : (result.message ?? '页面打开失败');

export interface PageTabsProps {
  pages: DesignPageSnapshot[];
  activePath: string | null;
  /** 工作区全部 HTML 文件；未打开的进入「打开页面」下拉。 */
  files: string[];
  onActivate: (path: string) => void;
  /** 关闭请求：dirty 页由面板先弹确认框（保存 / 放弃修改 / 取消）。 */
  onClose: (path: string) => void;
  /** 打开未打开的文件（controller.open）；结果由本组件提示。 */
  onOpen: (path: string) => Promise<OpenPageResult>;
}

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1) || path;

/**
 * 多页标签条（P2 §7）：每页一个标签（basename + title 全路径、脏点 •、
 * 缺失 ⚠、关闭 ×），点击激活；「打开页面」下拉列出未打开的文件，
 * open 返回 limit 失败时提示「先关闭未保存的页面」。
 */
export function PageTabs({ pages, activePath, files, onActivate, onClose, onOpen }: PageTabsProps) {
  const [notice, setNotice] = useState('');

  const openOptions = useMemo(() => {
    const open = new Set(pages.map(page => page.path));
    return files.filter(path => !open.has(path)).map(path => ({ value: path, label: path }));
  }, [pages, files]);

  const handleOpen = async (path: string) => {
    setNotice('');
    const result = await onOpen(path);
    if (result.ok) return;
    setNotice(openFailureMessage(result));
  };

  return (
    <div className="flex items-center gap-2 border-b border-border px-2 py-1">
      <div
        role="tablist"
        aria-label="设计页面"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        {pages.map(page => {
          const active = page.path === activePath;
          return (
            <div
              key={page.path}
              className={`group flex shrink-0 items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors ${
                active
                  ? 'border-primary/40 bg-primary/10 text-foreground'
                  : 'border-transparent text-muted-foreground hover:bg-secondary'
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                title={page.path}
                onClick={() => onActivate(page.path)}
                className="flex items-center gap-1 outline-none"
              >
                {page.status === 'dirty' && (
                  <span aria-hidden className="text-warning">
                    •
                  </span>
                )}
                <span className="max-w-40 truncate">{basename(page.path)}</span>
                {page.missing && (
                  <span title="此文件已从工作区消失" aria-label={`文件缺失 ${page.path}`}>
                    ⚠
                  </span>
                )}
              </button>
              <button
                type="button"
                aria-label={`关闭 ${page.path}`}
                title="关闭页面"
                onClick={() => onClose(page.path)}
                className="rounded p-0.5 leading-none text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <Select
        value=""
        onChange={path => void handleOpen(path)}
        options={openOptions}
        placeholder="打开页面"
        ariaLabel="打开页面"
        disabled={openOptions.length === 0}
        size="sm"
        className="w-32 shrink-0"
      />
      {notice && (
        <div role="status" className="shrink-0 text-[11px] text-warning">
          {notice}
        </div>
      )}
    </div>
  );
}
