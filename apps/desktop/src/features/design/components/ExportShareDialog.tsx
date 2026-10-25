import { useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { ExportDialogContent } from './ExportDialogContent';
import type { ExportDialogContentProps } from './ExportDialogContent';
import { RenderExportContent } from './RenderExportContent';
import type { RenderExportContentProps } from './RenderExportContent';
import { ShareContent } from './ShareContent';
import type { ShareContentProps } from './ShareContent';

type ExportShareTab = 'export' | 'render' | 'share';

const TABS: Array<{ value: ExportShareTab; label: string }> = [
  { value: 'export', label: 'Export ZIP' },
  { value: 'render', label: 'Render PNG/PDF' },
  { value: 'share', label: 'Share' },
];

export interface ExportShareDialogProps {
  open: boolean;
  onClose: () => void;
  /** ZIP export props; `open`/`onClose` are owned by this dialog. */
  exportProps: Omit<ExportDialogContentProps, 'open' | 'onClose'>;
  /** Render export props; `open`/`onClose` are owned by this dialog. */
  renderProps: Omit<RenderExportContentProps, 'open' | 'onClose'>;
  /** Share management props; `open`/`onClose` are owned by this dialog. */
  shareProps: Omit<ShareContentProps, 'open' | 'onClose'>;
}

const panelId = (tab: ExportShareTab): string => `export-share-panel-${tab}`;
const tabId = (tab: ExportShareTab): string => `export-share-tab-${tab}`;

/**
 * 合并后的 Export & Share 对话框（P5a §4.8）：一个 Modal + 三页签。
 *
 * 不变量：只要对话框打开，三个内容**同时挂载**（切页签只改 `hidden` 与
 * `aria-selected`，绝不卸载或改各 Content 的 `open`），否则 Render 的长任务
 * 会因切页签中断。关闭整个对话框时子内容随 Modal 卸载，下次打开回到 Export
 * 页签并按各内容原有语义重置/取消。页脚动作在各 Content 内，因此合并后仍可用；
 * 所有关闭按钮/遮罩/Esc 都走同一个 `onClose`。
 */
export function ExportShareDialog(props: ExportShareDialogProps) {
  // 关闭时整棵子树卸载：每个 Content 按原独立组件语义复位/取消，下一次打开
  // 由 Open 子组件重新以默认 Export 页签挂载。
  if (!props.open) return null;
  return <ExportShareDialogOpen {...props} />;
}

function ExportShareDialogOpen({
  onClose,
  exportProps,
  renderProps,
  shareProps,
}: ExportShareDialogProps) {
  const [tab, setTab] = useState<ExportShareTab>('export');

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel="Export & Share"
      title="Export & Share"
      size="2xl"
    >
      <div className="flex flex-col">
        <div
          role="tablist"
          aria-label="Export and share"
          className="mx-4 mt-3 flex w-fit gap-0.5 rounded-md bg-secondary p-0.5"
        >
          {TABS.map(entry => (
            <button
              key={entry.value}
              id={tabId(entry.value)}
              type="button"
              role="tab"
              aria-selected={tab === entry.value}
              aria-controls={panelId(entry.value)}
              className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                tab === entry.value
                  ? 'bg-card text-foreground shadow-apple-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setTab(entry.value)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div
          id={panelId('export')}
          data-testid="export-share-panel-export"
          role="tabpanel"
          aria-labelledby={tabId('export')}
          hidden={tab !== 'export'}
        >
          <ExportDialogContent open onClose={onClose} {...exportProps} />
        </div>
        <div
          id={panelId('render')}
          data-testid="export-share-panel-render"
          role="tabpanel"
          aria-labelledby={tabId('render')}
          hidden={tab !== 'render'}
        >
          <RenderExportContent open onClose={onClose} {...renderProps} />
        </div>
        <div
          id={panelId('share')}
          data-testid="export-share-panel-share"
          role="tabpanel"
          aria-labelledby={tabId('share')}
          hidden={tab !== 'share'}
        >
          <ShareContent open onClose={onClose} {...shareProps} />
        </div>
      </div>
    </Modal>
  );
}
