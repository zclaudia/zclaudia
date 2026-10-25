import { MousePointer2, PanelLeft, Play, Presentation, Redo2, Undo2 } from 'lucide-react';
import { Button, IconButton } from '../../../components/ui/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import { PageTabs } from './PageTabs';
import { ViewportBar } from './ViewportBar';
import { MoreMenu } from './MoreMenu';
import type { DropdownMenuEntry } from '../../../components/ui/DropdownMenu';
import type { DesignTier } from './tiers';
import type { DesignPageSnapshot } from '../workspace/controller';
import type { DesignViewport } from '../types';

export interface TopBarProps {
  tier: DesignTier;
  compact: boolean;
  pages: DesignPageSnapshot[];
  activePath: string | null;
  files: string[];
  viewport: DesignViewport;
  zoom: { mode: 'fit' | 'manual'; value: number };
  actualScale: number | null;
  previewMode: 'edit' | 'run';
  deckAvailable: boolean;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  busy: boolean;
  loading: boolean;
  leftOpen: boolean;
  overviewOpen: boolean;
  treeOpen: boolean;
  docPath: string | null;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onOpen: (path: string) => void;
  onViewportChange: (viewport: DesignViewport) => void;
  onZoomChange: (zoom: { mode: 'fit' | 'manual'; value: number }) => void;
  onPreviewModeChange: (mode: 'edit' | 'run') => void;
  onSlides: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onToggleLeft: () => void;
  onExport: () => void;
  onRenderExport: () => void;
  onShare: () => void;
  onDiff: () => void;
  onReload: () => void;
  onRefresh: () => void;
  onTemplates: () => void;
  onBrand: () => void;
  onAssets: () => void;
  onMedia: () => void;
  onToggleOverview: () => void;
  onToggleTree: () => void;
}

const ZOOM_STEP = 0.1;
const clampZoom = (value: number): number =>
  Math.min(2, Math.max(0.25, Math.round(value * 100) / 100));

/**
 * 单行顶栏（P1 §4.1）：页签 / 视口与缩放 / 模式 / 撤销重做 / Save / ⋯。
 * 一行只有一个实心按钮（Save）；窄档把视口、缩放、撤销重做收进 ⋯ 菜单。
 */
export function TopBar({
  tier,
  compact,
  pages,
  activePath,
  files,
  viewport,
  zoom,
  actualScale,
  previewMode,
  deckAvailable,
  canUndo,
  canRedo,
  dirty,
  busy,
  loading,
  leftOpen,
  overviewOpen,
  treeOpen,
  docPath,
  onActivate,
  onClose,
  onOpen,
  onViewportChange,
  onZoomChange,
  onPreviewModeChange,
  onSlides,
  onUndo,
  onRedo,
  onSave,
  onToggleLeft,
  onExport,
  onRenderExport,
  onShare,
  onDiff,
  onReload,
  onRefresh,
  onTemplates,
  onBrand,
  onAssets,
  onMedia,
  onToggleOverview,
  onToggleTree,
}: TopBarProps) {
  const narrow = tier === 'narrow';
  const showModeLabels = !compact && !narrow;

  const narrowEntries: DropdownMenuEntry[] = narrow
    ? [
        'separator',
        {
          key: 'undo-narrow',
          label: 'Undo',
          onSelect: onUndo,
          disabled: !canUndo || busy,
        },
        {
          key: 'redo-narrow',
          label: 'Redo',
          onSelect: onRedo,
          disabled: !canRedo || busy,
        },
        'separator',
        {
          key: 'viewport-desktop',
          label: 'Desktop 1280',
          onSelect: () => onViewportChange({ preset: 'desktop', width: 1280 }),
        },
        {
          key: 'viewport-tablet',
          label: 'Tablet 768',
          onSelect: () => onViewportChange({ preset: 'tablet', width: 768 }),
        },
        {
          key: 'viewport-mobile',
          label: 'Mobile 390',
          onSelect: () => onViewportChange({ preset: 'mobile', width: 390 }),
        },
        {
          key: 'viewport-fill',
          label: 'Fill',
          onSelect: () => onViewportChange({ preset: 'fill', width: null }),
        },
        'separator',
        {
          key: 'zoom-out-narrow',
          label: 'Zoom out',
          onSelect: () =>
            onZoomChange({ mode: 'manual', value: clampZoom(zoom.value - ZOOM_STEP) }),
          disabled: viewport.preset === 'fill' || zoom.value <= 0.25,
        },
        {
          key: 'zoom-in-narrow',
          label: 'Zoom in',
          onSelect: () =>
            onZoomChange({ mode: 'manual', value: clampZoom(zoom.value + ZOOM_STEP) }),
          disabled: viewport.preset === 'fill' || zoom.value >= 2,
        },
        {
          key: 'zoom-fit-narrow',
          label: 'Fit width',
          onSelect: () =>
            onZoomChange(
              zoom.mode === 'fit'
                ? { mode: 'manual', value: zoom.value }
                : { mode: 'fit', value: zoom.value }
            ),
          disabled: viewport.preset === 'fill',
        },
      ]
    : [];

  return (
    <div
      data-testid="design-topbar"
      className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border px-2"
    >
      {narrow && (
        <Tooltip content="Pages / Layers / Library">
          <IconButton
            aria-label="Toggle pages panel"
            aria-pressed={leftOpen}
            onClick={onToggleLeft}
          >
            <PanelLeft size={15} strokeWidth={1.75} />
          </IconButton>
        </Tooltip>
      )}
      <PageTabs
        pages={pages}
        activePath={activePath}
        files={files}
        onActivate={onActivate}
        onClose={onClose}
        onOpen={onOpen}
        showOnlyActive={narrow}
      />
      <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
      {!narrow && (
        <ViewportBar
          viewport={viewport}
          zoom={zoom}
          actualScale={actualScale}
          onViewportChange={onViewportChange}
          onZoomChange={onZoomChange}
        />
      )}
      <div className="flex-1" />
      <div
        role="group"
        aria-label="Preview mode"
        className="flex items-center gap-0.5 rounded-md bg-secondary p-0.5"
      >
        <button
          type="button"
          aria-label="Edit mode"
          aria-pressed={previewMode === 'edit'}
          onClick={() => onPreviewModeChange('edit')}
          className={`flex h-6 items-center gap-1 rounded px-1.5 text-[11px] transition-colors ${
            previewMode === 'edit'
              ? 'bg-background font-medium text-foreground shadow-apple-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <MousePointer2 size={12} strokeWidth={1.75} />
          {showModeLabels && 'Edit'}
        </button>
        <button
          type="button"
          aria-label="Run mode"
          aria-pressed={previewMode === 'run'}
          onClick={() => onPreviewModeChange('run')}
          className={`flex h-6 items-center gap-1 rounded px-1.5 text-[11px] transition-colors ${
            previewMode === 'run'
              ? 'bg-background font-medium text-foreground shadow-apple-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Play size={12} strokeWidth={1.75} />
          {showModeLabels && 'Run'}
        </button>
        <Tooltip
          content={
            deckAvailable
              ? 'Open the slides panel'
              : 'This page has no slide markers (data-zclaudia-slide)'
          }
        >
          <button
            type="button"
            aria-label="Slides"
            disabled={!deckAvailable}
            onClick={onSlides}
            className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            <Presentation size={12} strokeWidth={1.75} />
            {showModeLabels && 'Slides'}
          </button>
        </Tooltip>
      </div>
      {!narrow && (
        <>
          <Tooltip content="Undo ⌘Z">
            <IconButton aria-label="Undo" disabled={!canUndo || busy} onClick={onUndo}>
              <Undo2 size={14} strokeWidth={1.75} />
            </IconButton>
          </Tooltip>
          <Tooltip content="Redo ⇧⌘Z">
            <IconButton aria-label="Redo" disabled={!canRedo || busy} onClick={onRedo}>
              <Redo2 size={14} strokeWidth={1.75} />
            </IconButton>
          </Tooltip>
        </>
      )}
      <Tooltip content="Save ⌘S">
        <Button
          size="sm"
          variant="primary"
          className="ml-1 h-7 px-2.5 text-[12px]"
          onClick={onSave}
          disabled={!dirty || busy}
        >
          Save
        </Button>
      </Tooltip>
      <MoreMenu
        docPath={docPath}
        loading={loading}
        busy={busy}
        dirty={dirty}
        deckAvailable={deckAvailable}
        overviewOpen={overviewOpen}
        treeOpen={treeOpen}
        onExport={onExport}
        onRenderExport={onRenderExport}
        onShare={onShare}
        onDiff={onDiff}
        onReload={onReload}
        onRefresh={onRefresh}
        onTemplates={onTemplates}
        onBrand={onBrand}
        onAssets={onAssets}
        onMedia={onMedia}
        onToggleOverview={onToggleOverview}
        onToggleTree={onToggleTree}
        onSlides={onSlides}
        extraEntries={narrowEntries}
      />
    </div>
  );
}
