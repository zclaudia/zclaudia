import {
  Download,
  FileDiff,
  ImageDown,
  Images,
  LayoutGrid,
  ListTree,
  MoreHorizontal,
  Palette,
  Presentation,
  RefreshCw,
  RotateCw,
  Share2,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { IconButton } from '../../../components/ui/Button';
import { DropdownMenu } from '../../../components/ui/DropdownMenu';
import type { DropdownMenuEntry } from '../../../components/ui/DropdownMenu';
import { Tooltip } from '../../../components/ui/Tooltip';

const menuIcon = (Icon: typeof Download) => <Icon size={14} strokeWidth={1.75} />;

export interface MoreMenuProps {
  docPath: string | null;
  loading: boolean;
  busy: boolean;
  dirty: boolean;
  deckAvailable: boolean;
  overviewOpen: boolean;
  treeOpen: boolean;
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
  onSlides: () => void;
  /** 窄档收纳的额外条目（视口 / 缩放 / 撤销重做）。 */
  extraEntries?: DropdownMenuEntry[];
}

/**
 * 顶栏 `⋯` 菜单（P1 §4.1）：低频动作与（窄档）收纳后的高频动作。
 * 菜单条目沿用既有可访问名称，入口换位但能力不减。
 */
export function MoreMenu({
  docPath,
  loading,
  busy,
  dirty,
  deckAvailable,
  overviewOpen,
  treeOpen,
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
  onSlides,
  extraEntries = [],
}: MoreMenuProps) {
  const entries: DropdownMenuEntry[] = [
    {
      key: 'export',
      label: 'Export',
      icon: menuIcon(Download),
      onSelect: onExport,
      disabled: !docPath || loading,
    },
    {
      key: 'render-export',
      label: 'Render export',
      icon: menuIcon(ImageDown),
      onSelect: onRenderExport,
      disabled: !docPath || loading,
    },
    {
      key: 'share',
      label: 'Share',
      icon: menuIcon(Share2),
      onSelect: onShare,
      disabled: !docPath || loading,
    },
    'separator',
    {
      key: 'diff',
      label: 'Unsaved changes',
      icon: menuIcon(FileDiff),
      onSelect: onDiff,
      disabled: !dirty,
    },
    {
      key: 'reload',
      label: 'Reload',
      icon: menuIcon(RotateCw),
      onSelect: onReload,
      disabled: !docPath || busy,
    },
    {
      key: 'refresh',
      label: 'Refresh design files',
      icon: menuIcon(RefreshCw),
      onSelect: onRefresh,
    },
    'separator',
    { key: 'templates', label: 'Templates', icon: menuIcon(Sparkles), onSelect: onTemplates },
    { key: 'brand', label: 'Brand', icon: menuIcon(Palette), onSelect: onBrand },
    { key: 'assets', label: 'Assets', icon: menuIcon(Images), onSelect: onAssets },
    { key: 'media', label: 'Media', icon: menuIcon(Wand2), onSelect: onMedia },
    'separator',
    {
      key: 'overview',
      label: overviewOpen ? 'Overview (on)' : 'Overview',
      icon: menuIcon(LayoutGrid),
      onSelect: onToggleOverview,
    },
    {
      key: 'structure',
      label: treeOpen ? 'Structure (on)' : 'Structure',
      icon: menuIcon(ListTree),
      onSelect: onToggleTree,
    },
    {
      key: 'slides',
      label: 'Slides',
      icon: menuIcon(Presentation),
      onSelect: onSlides,
      disabled: !deckAvailable,
    },
    ...extraEntries,
  ];

  return (
    <DropdownMenu
      ariaLabel="More actions"
      align="end"
      entries={entries}
      trigger={({ ref, props }) => (
        <Tooltip content="More actions">
          <IconButton
            {...props}
            ref={ref}
            aria-label="More actions"
            aria-pressed={props['aria-expanded']}
          >
            <MoreHorizontal size={15} strokeWidth={1.75} />
          </IconButton>
        </Tooltip>
      )}
    />
  );
}
