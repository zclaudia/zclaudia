import { Modal } from '../../../components/ui/Modal';
import type { DeckInfo } from '../deck';
import { SlidesView } from '../rail/SlidesView';

export interface DeckPanelProps {
  open: boolean;
  /** 活动页信息；null = 关闭态。 */
  page: { path: string; source: string; busy: boolean } | null;
  /** 已构建的活动页静态预览 HTML（复用面板缓存）；null = 构建中。 */
  previewHtml: string | null;
  /** deck 结构（面板按 draftRevision memo 的 parseDeck 结果）。 */
  deck: DeckInfo | null;
  /** 提交源码变换（面板接 controller.applySource）；false = 未生效。 */
  onCommit: (source: string, label: string) => Promise<boolean>;
  onPresent: (startIndex: number) => void;
  onClose: () => void;
}

/**
 * 幻灯片面板的 Modal 兼容薄壳（P5b §4.8）：状态机与 UI 已搬入左栏
 * `rail/SlidesView.tsx`，此处只提供原 Modal 外观，保留既有独立面板测试与
 * 兜底入口；运行时 Slides 入口直接切到左栏页签。
 */
export function DeckPanel({
  open,
  page,
  previewHtml,
  deck,
  onCommit,
  onPresent,
  onClose,
}: DeckPanelProps) {
  if (!open || !page) return null;
  return (
    <Modal open onClose={onClose} ariaLabel="Slides" title="Slides" size="2xl">
      <SlidesView
        active
        page={page}
        previewHtml={previewHtml}
        deck={deck}
        onCommit={onCommit}
        onPresent={onPresent}
      />
    </Modal>
  );
}
