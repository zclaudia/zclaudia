import type { ReactNode } from 'react';
import { Image, Palette, Presentation, Wand2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import type { DesignLibraryTab } from '../stores/designLayoutStore';

export interface LibraryViewProps {
  libraryTab: DesignLibraryTab;
  onLibraryTabChange: (tab: DesignLibraryTab) => void;
  assets: ReactNode;
  templates: ReactNode;
  onOpenBrand: () => void;
  onOpenMedia: () => void;
}

const TABS: Array<{ id: DesignLibraryTab; label: string }> = [
  { id: 'assets', label: 'Assets' },
  { id: 'templates', label: 'Templates' },
  { id: 'brand', label: 'Brand' },
  { id: 'media', label: 'Media' },
];

const LAUNCHER_COPY = {
  brand: {
    title: 'Brand',
    body: 'Edit DESIGN.md and design tokens so the Agent follows your system.',
    action: 'Edit brand',
    aria: 'Open brand editor',
    icon: Palette,
  },
  media: {
    title: 'Media',
    body: 'Generate images or video from a prompt and drop the result into the page.',
    action: 'Generate media',
    aria: 'Open media generator',
    icon: Wand2,
  },
} as const;

/** P4b: Assets/Templates stay mounted inline; Brand/Media keep their dialog launchers until P4c. */
export function LibraryView({
  libraryTab,
  onLibraryTabChange,
  assets,
  templates,
  onOpenBrand,
  onOpenMedia,
}: LibraryViewProps) {
  const launcherTab = libraryTab === 'brand' || libraryTab === 'media' ? libraryTab : null;
  const copy = launcherTab === null ? null : LAUNCHER_COPY[launcherTab];
  const Icon = copy?.icon ?? Image;
  const openLauncher = launcherTab === 'brand' ? onOpenBrand : onOpenMedia;

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
      <div hidden={libraryTab !== 'assets'}>{assets}</div>
      <div hidden={libraryTab !== 'templates'}>{templates}</div>
      {copy !== null && launcherTab !== null && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            <Icon size={15} strokeWidth={1.75} />
          </span>
          <div className="text-xs font-medium">{copy.title}</div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{copy.body}</p>
          <Button size="sm" variant="outline" aria-label={copy.aria} onClick={openLauncher}>
            {copy.action}
          </Button>
        </div>
      )}
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
