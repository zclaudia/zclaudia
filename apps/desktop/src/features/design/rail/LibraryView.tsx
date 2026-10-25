import type { ReactNode } from 'react';
import { ExternalLink, Maximize2, Presentation } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import type { DesignLibraryTab } from '../stores/designLayoutStore';

export interface LibraryViewProps {
  libraryTab: DesignLibraryTab;
  onLibraryTabChange: (tab: DesignLibraryTab) => void;
  assets: ReactNode;
  templates: ReactNode;
  brand: ReactNode;
  media: ReactNode;
  /** Raise the left rail to at least 320px (never shrink a wider panel). */
  onExpand: () => void;
  /** Modal fallbacks for the form-shaped views. */
  onOpenBrand: () => void;
  onOpenMedia: () => void;
}

const TABS: Array<{ id: DesignLibraryTab; label: string }> = [
  { id: 'assets', label: 'Assets' },
  { id: 'templates', label: 'Templates' },
  { id: 'brand', label: 'Brand' },
  { id: 'media', label: 'Media' },
];

const UTILITY_COPY = {
  brand: { label: 'Brand', openInDialog: 'Open Brand in dialog' },
  media: { label: 'Media', openInDialog: 'Open Media in dialog' },
} as const;

/**
 * 左栏 Library（P4b/P4c §4.6）：四个页签全部内嵌，不再用启动卡片打断上下文。
 * Brand / Media 是表单型视图，顶部给一行安静的工具动作：Expand 把左栏抬到
 * 320px；Open in dialog 仍走原 Modal 薄壳（兼容与兜底，同时暂停内嵌实例）。
 */
export function LibraryView({
  libraryTab,
  onLibraryTabChange,
  assets,
  templates,
  brand,
  media,
  onExpand,
  onOpenBrand,
  onOpenMedia,
}: LibraryViewProps) {
  const utilityTab = libraryTab === 'brand' || libraryTab === 'media' ? libraryTab : null;
  const utility = utilityTab === null ? null : UTILITY_COPY[utilityTab];
  const openInDialog = utilityTab === 'brand' ? onOpenBrand : onOpenMedia;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div
        role="tablist"
        aria-label="Library sections"
        className="grid shrink-0 grid-cols-4 gap-0.5 rounded-md border border-border p-0.5"
      >
        {TABS.map(tab => {
          const active = tab.id === libraryTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onLibraryTabChange(tab.id)}
              className={`h-6 rounded text-[10px] transition-colors ${
                active
                  ? 'bg-secondary font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {utility !== null && utilityTab !== null && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Expand ${utility.label} view`}
            onClick={onExpand}
          >
            <Maximize2 size={12} strokeWidth={1.75} />
            Expand
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={utility.openInDialog}
            onClick={openInDialog}
          >
            <ExternalLink size={12} strokeWidth={1.75} />
            Open in dialog
          </Button>
        </div>
      )}
      <div hidden={libraryTab !== 'assets'}>{assets}</div>
      <div hidden={libraryTab !== 'templates'}>{templates}</div>
      <div hidden={libraryTab !== 'brand'}>{brand}</div>
      <div hidden={libraryTab !== 'media'}>{media}</div>
    </div>
  );
}

export interface SlidesViewProps {
  deckAvailable: boolean;
  slideCount: number | null;
  onOpenSlides: () => void;
}

/** 左栏 Slides（P5b 的过渡形态）：检测到 deck 时显示页数并打开原面板。 */
export function SlidesView({ deckAvailable, slideCount, onOpenSlides }: SlidesViewProps) {
  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex flex-col gap-2 rounded-md border border-border p-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
          <Presentation size={15} strokeWidth={1.75} />
        </span>
        <div className="text-xs font-medium">Slides</div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {deckAvailable
            ? `This page defines ${slideCount ?? 0} slide${slideCount === 1 ? '' : 's'}.`
            : 'This page has no slide markers (data-zclaudia-slide).'}
        </p>
        <Button
          size="sm"
          variant="outline"
          aria-label="Open slides panel"
          onClick={onOpenSlides}
          disabled={!deckAvailable}
        >
          Open slides
        </Button>
      </div>
    </div>
  );
}
