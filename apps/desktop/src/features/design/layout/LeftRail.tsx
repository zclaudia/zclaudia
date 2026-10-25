import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { FileText, Library, ListTree, PanelLeftClose, Presentation } from 'lucide-react';
import { IconButton } from '../../../components/ui/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import { DESIGN_LEFT_WIDTH_MAX, DESIGN_LEFT_WIDTH_MIN } from '../stores/designLayoutStore';
import type { DesignLeftTab } from '../stores/designLayoutStore';
import type { DesignTier } from './tiers';

export interface LeftRailProps {
  tier: DesignTier;
  open: boolean;
  tab: DesignLeftTab;
  width: number;
  deckAvailable: boolean;
  onSelectTab: (tab: DesignLeftTab) => void;
  onToggle: () => void;
  onResize: (width: number) => void;
  pages: ReactNode;
  layers: ReactNode;
  library: ReactNode;
  slides: ReactNode;
}

const TABS: Array<{ id: DesignLeftTab; label: string; icon: typeof FileText }> = [
  { id: 'pages', label: 'Pages panel', icon: FileText },
  { id: 'layers', label: 'Layers panel', icon: ListTree },
  { id: 'library', label: 'Library panel', icon: Library },
];

/**
 * 左栏（P1/P4 §4.6）：40px 图标条常驻 + 面板宿主（宽档在流内，中档抽屉
 * 覆盖画布，窄档整栏抽屉）。面板宽度 200–420，右缘拖拽改宽（pointer 事件，
 * 不复用绑定工作区几何的 ResizeDivider）。
 */
export function LeftRail({
  tier,
  open,
  tab,
  width,
  deckAvailable,
  onSelectTab,
  onToggle,
  onResize,
  pages,
  layers,
  library,
  slides,
}: LeftRailProps) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = Math.min(
        DESIGN_LEFT_WIDTH_MAX,
        Math.max(DESIGN_LEFT_WIDTH_MIN, drag.startWidth + event.clientX - drag.startX)
      );
      onResize(next);
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [onResize]);

  const startResize = (event: ReactPointerEvent) => {
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startWidth: width };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const tabs = deckAvailable
    ? [...TABS, { id: 'slides' as const, label: 'Slides panel', icon: Presentation }]
    : TABS;

  const panelTitles: Record<DesignLeftTab, string> = {
    pages: 'Pages',
    layers: 'Layers',
    library: 'Library',
    slides: 'Slides',
  };

  const widthStyle = { width: tier === 'wide' ? width : 240 };

  const rootTierClass =
    tier === 'wide'
      ? 'relative flex min-h-0 shrink-0 border-r border-border bg-sidebar'
      : tier === 'medium'
        ? 'relative flex min-h-0 w-10 shrink-0 border-r border-border bg-sidebar'
        : `absolute inset-y-0 left-0 z-dropdown flex min-h-0 border-r border-border bg-sidebar shadow-apple-lg ${
            open ? '' : 'hidden'
          }`;

  return (
    <div data-testid="design-rail" data-open={open} className={rootTierClass}>
      <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-border/70 py-2">
        {tabs.map(({ id, label, icon: Icon }) => (
          <Tooltip key={id} content={panelTitles[id]} side="bottom">
            <IconButton
              size="sm"
              aria-label={label}
              aria-pressed={open && tab === id}
              onClick={() => {
                if (open && tab === id) onToggle();
                else onSelectTab(id);
              }}
              className={`h-[30px] w-[30px] ${
                open && tab === id ? 'bg-secondary text-foreground' : ''
              }`}
            >
              <Icon size={15} strokeWidth={1.75} />
            </IconButton>
          </Tooltip>
        ))}
      </div>
      <div
        data-testid="design-rail-panel"
        style={widthStyle}
        className={`${
          tier === 'wide'
            ? 'min-h-0 flex-col'
            : 'absolute inset-y-0 left-10 z-dropdown min-h-0 flex-col border-r border-border bg-sidebar shadow-apple-lg'
        } ${open ? 'flex' : 'hidden'}`}
      >
        <div className="flex h-9 shrink-0 items-center justify-between pl-3 pr-1">
          <span className="text-[11px] font-medium text-muted-foreground">{panelTitles[tab]}</span>
          <Tooltip content="Collapse panel">
            <IconButton size="sm" aria-label="Collapse panel" onClick={onToggle}>
              <PanelLeftClose size={13} strokeWidth={1.75} />
            </IconButton>
          </Tooltip>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div hidden={tab !== 'pages'} className="min-h-0 flex-1 overflow-auto">
            {pages}
          </div>
          <div hidden={tab !== 'layers'} className="min-h-0 flex-1 overflow-auto">
            {layers}
          </div>
          <div hidden={tab !== 'library'} className="min-h-0 flex-1 overflow-auto">
            {library}
          </div>
          <div hidden={tab !== 'slides'} className="min-h-0 flex-1 overflow-auto">
            {slides}
          </div>
        </div>
        {tier === 'wide' && open && (
          <div
            role="separator"
            aria-label="Resize panel"
            aria-orientation="vertical"
            tabIndex={0}
            onPointerDown={startResize}
            className="absolute inset-y-0 right-0 w-1 cursor-col-resize transition-colors hover:bg-border"
          />
        )}
      </div>
    </div>
  );
}
