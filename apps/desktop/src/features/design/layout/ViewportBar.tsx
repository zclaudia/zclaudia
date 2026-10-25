import { useEffect, useState } from 'react';
import { Maximize2, Minus, Monitor, Plus, Smartphone, Tablet } from 'lucide-react';
import { IconButton } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Tooltip } from '../../../components/ui/Tooltip';
import type { DesignViewport, DesignViewportPreset } from '../types';

export interface ViewportBarProps {
  viewport: DesignViewport;
  zoom: { mode: 'fit' | 'manual'; value: number };
  /** PreviewCanvas 回报的实际缩放（fit 模式下 zoom.value 是陈旧值）。 */
  actualScale?: number | null;
  onViewportChange: (viewport: DesignViewport) => void;
  onZoomChange: (zoom: { mode: 'fit' | 'manual'; value: number }) => void;
}

const WIDTH_MIN = 240;
const WIDTH_MAX = 3840;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

const clampZoom = (value: number): number =>
  // 步进 10%，夹在 25%–200%；避开二进制小数误差。
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));

const PRESET_WIDTH: Partial<Record<DesignViewportPreset, number>> = {
  desktop: 1280,
  tablet: 768,
  mobile: 390,
};

const DEVICES: Array<{
  preset: DesignViewportPreset;
  label: string;
  title: string;
  Icon: typeof Monitor;
}> = [
  { preset: 'desktop', label: 'Desktop viewport', title: 'Desktop 1280', Icon: Monitor },
  { preset: 'tablet', label: 'Tablet viewport', title: 'Tablet 768', Icon: Tablet },
  { preset: 'mobile', label: 'Mobile viewport', title: 'Mobile 390', Icon: Smartphone },
];

/**
 * 顶栏中部视口/缩放（P1 §4.1）：设备图标（aria-pressed）+ 宽度输入 +
 * 缩放 −/百分比/＋。百分比在 fit 模式显示「Fit · 实际%」，单击在 fit/manual
 * 间切换，双击回 100%；fill 预设下缩放控件禁用（沿用）。
 * 宽度校验与持久化语义不变（240–3840 整数，非法回退，提交即 custom）。
 */
export function ViewportBar({
  viewport,
  zoom,
  actualScale,
  onViewportChange,
  onZoomChange,
}: ViewportBarProps) {
  const fill = viewport.preset === 'fill';
  const [widthText, setWidthText] = useState(() => String(viewport.width ?? ''));

  // 外部视口变化（含存储恢复、预设切换）时同步输入框显示。
  useEffect(() => {
    setWidthText(viewport.width === null ? '' : String(viewport.width));
  }, [viewport.preset, viewport.width]);

  const choosePreset = (preset: DesignViewportPreset) => {
    if (preset === 'fill') {
      onViewportChange({ preset: 'fill', width: null });
      return;
    }
    const width = PRESET_WIDTH[preset] ?? viewport.width ?? 1280;
    onViewportChange({ preset, width });
  };

  /** 非法输入回退为当前宽度显示；合法值以 custom 预设提交。 */
  const commitWidth = () => {
    const parsed = Number.parseInt(widthText.trim(), 10);
    if (
      Number.isInteger(parsed) &&
      parsed >= WIDTH_MIN &&
      parsed <= WIDTH_MAX &&
      String(parsed) === widthText.trim()
    ) {
      onViewportChange({ preset: 'custom', width: parsed });
    } else {
      setWidthText(viewport.width === null ? '' : String(viewport.width));
    }
  };

  const scalePercent = Math.round((actualScale ?? zoom.value) * 100);
  const fitLabel = zoom.mode === 'fit' && !fill;
  const zoomLabel = fitLabel ? `Fit · ${scalePercent}%` : `${scalePercent}%`;

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      {DEVICES.map(({ preset, label, title, Icon }) => (
        <Tooltip key={preset} content={title}>
          <IconButton
            size="sm"
            aria-label={label}
            aria-pressed={viewport.preset === preset}
            onClick={() => choosePreset(preset)}
            className={viewport.preset === preset ? 'bg-secondary text-foreground' : ''}
          >
            <Icon size={14} strokeWidth={1.75} />
          </IconButton>
        </Tooltip>
      ))}
      <Tooltip content="Fill the canvas width">
        <IconButton
          size="sm"
          aria-label="Fill viewport"
          aria-pressed={viewport.preset === 'fill'}
          onClick={() => choosePreset('fill')}
          className={viewport.preset === 'fill' ? 'bg-secondary text-foreground' : ''}
        >
          <Maximize2 size={14} strokeWidth={1.75} />
        </IconButton>
      </Tooltip>
      {!fill && (
        <Input
          aria-label="Custom width"
          inputMode="numeric"
          value={widthText}
          onChange={event => setWidthText(event.target.value)}
          onBlur={commitWidth}
          onKeyDown={event => {
            if (event.key === 'Enter') commitWidth();
          }}
          className="h-6 w-[62px] px-1.5 py-0 text-center text-[11px]"
          placeholder="240–3840"
        />
      )}
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />
      <Tooltip content="Zoom out">
        <IconButton
          size="sm"
          aria-label="Zoom out"
          disabled={fill || zoom.value <= ZOOM_MIN}
          onClick={() => onZoomChange({ mode: 'manual', value: clampZoom(zoom.value - ZOOM_STEP) })}
        >
          <Minus size={13} strokeWidth={1.75} />
        </IconButton>
      </Tooltip>
      <button
        type="button"
        aria-label={`Zoom ${zoomLabel}, double-click to reset`}
        disabled={fill}
        onDoubleClick={() => onZoomChange({ mode: 'manual', value: 1 })}
        onClick={() =>
          onZoomChange(
            zoom.mode === 'fit'
              ? { mode: 'manual', value: zoom.value }
              : { mode: 'fit', value: zoom.value }
          )
        }
        className="h-6 min-w-[58px] rounded-md px-1 text-center text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
      >
        {zoomLabel}
      </button>
      <Tooltip content="Zoom in">
        <IconButton
          size="sm"
          aria-label="Zoom in"
          disabled={fill || zoom.value >= ZOOM_MAX}
          onClick={() => onZoomChange({ mode: 'manual', value: clampZoom(zoom.value + ZOOM_STEP) })}
        >
          <Plus size={13} strokeWidth={1.75} />
        </IconButton>
      </Tooltip>
      <Tooltip content="Fit to width">
        <IconButton
          size="sm"
          aria-label="Fit width"
          aria-pressed={zoom.mode === 'fit'}
          disabled={fill}
          onClick={() =>
            onZoomChange(
              zoom.mode === 'fit'
                ? { mode: 'manual', value: zoom.value }
                : { mode: 'fit', value: zoom.value }
            )
          }
          className={zoom.mode === 'fit' ? 'bg-secondary text-foreground' : ''}
        >
          <Maximize2 size={13} strokeWidth={1.75} className="rotate-45" />
        </IconButton>
      </Tooltip>
    </div>
  );
}
