import { MousePointer2, PanelLeft, Play, Redo2, Undo2 } from 'lucide-react';
import { Button, IconButton } from '../../../components/ui/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import { PageTabs } from './PageTabs';
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
  /** 以下视口/缩放 props 保留以维持既有调用兼容性；顶栏不再消费，改由 CanvasToolbar 使用。 */
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

/**
 * 单行顶栏（P1 §4.1）：页签 / 模式 / 撤销重做 / Save / ⋯。
 * 视口与缩放已移到画布上方的 CanvasToolbar，这里不再消费对应 props
 * （字段保留以维持既有调用兼容性）。一行只有一个实心按钮（Save）；
 * 窄档把撤销重做收进 ⋯ 菜单，Slides 只从 ⋯ 菜单/左栏进入。
 */
export function TopBar({
  tier,
  compact,
  pages,
  activePath,
  files,
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

  const narrowEntries: DropdownMenuEntry[] = [
    ...(compact
      ? ([
          'separator',
          {
            key: 'edit-compact',
            label: 'Edit mode',
            onSelect: () => onPreviewModeChange('edit'),
          },
          {
            key: 'run-compact',
            label: 'Run mode',
            onSelect: () => onPreviewModeChange('run'),
          },
        ] as DropdownMenuEntry[])
      : []),
    ...(narrow
      ? ([
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
        ] as DropdownMenuEntry[])
      : []),
  ];

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
      <div className="flex-1" />
      {!compact && (
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
              ? 'bg-card font-medium text-foreground shadow-apple-sm'
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
              ? 'bg-card font-medium text-foreground shadow-apple-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Play size={12} strokeWidth={1.75} />
          {showModeLabels && 'Run'}
        </button>
      </div>
      )}
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
