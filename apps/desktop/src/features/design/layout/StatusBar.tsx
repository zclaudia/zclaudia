import { PanelRight } from 'lucide-react';
import { Button, IconButton } from '../../../components/ui/Button';
import { TONE_DOT } from '../../../components/ui/tone';
import type { DesignViewport } from '../types';

export interface StatusBarProps {
  dirty: boolean;
  loading: boolean;
  busy: boolean;
  runMode: boolean;
  runBlocked: { scripts: number; links: number } | null;
  viewport: DesignViewport;
  /** 预格式化的缩放文案，如 '64%' 或 'Fit · 64%'。 */
  zoomLabel: string;
  onViewDiff: () => void;
  rightOpen: boolean;
  onToggleInspector: () => void;
}

/** 视口预设 → 状态栏文案；custom 缺 width 时退化为裸「Custom」。 */
function viewportLabel(viewport: DesignViewport): string {
  switch (viewport.preset) {
    case 'fill':
      return 'Fill';
    case 'desktop':
      return 'Desktop 1280';
    case 'tablet':
      return 'Tablet 768';
    case 'mobile':
      return 'Mobile 390';
    case 'custom':
      return viewport.width === null ? 'Custom' : `Custom ${viewport.width}px`;
  }
}

/** 画布状态栏：保存态 / 运行模式 / 视口与缩放 / 检查器开关。 */
export function StatusBar({
  dirty,
  loading,
  busy,
  runMode,
  runBlocked,
  viewport,
  zoomLabel,
  onViewDiff,
  rightOpen,
  onToggleInspector,
}: StatusBarProps): JSX.Element {
  return (
    <div className="flex h-[26px] shrink-0 items-center gap-3 border-t border-border px-3 text-[11px] text-muted-foreground select-none">
      {loading ? (
        <span>Loading…</span>
      ) : busy ? (
        <span>Saving…</span>
      ) : dirty ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-4 px-1"
          onClick={onViewDiff}
          aria-label="Unsaved changes"
        >
          <span
            aria-hidden
            className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT.warning}`}
          />
          Unsaved · View diff
        </Button>
      ) : (
        <span>Saved</span>
      )}
      {runMode && (
        <>
          <span role="status">Run mode: interaction only</span>
          {runBlocked && runBlocked.scripts + runBlocked.links > 0 && (
            <span>
              Removed {runBlocked.scripts} external script(s) and {runBlocked.links} external
              link(s)
            </span>
          )}
        </>
      )}
      <span className="flex-1" />
      <span>{viewportLabel(viewport)}</span>
      <span>{zoomLabel}</span>
      <IconButton
        size="sm"
        onClick={onToggleInspector}
        aria-label="Toggle inspector"
        aria-pressed={rightOpen}
      >
        <PanelRight size={12} strokeWidth={1.75} />
      </IconButton>
    </div>
  );
}
