import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import type { DesignViewport, DesignViewportPreset } from '../types';

export interface ViewportControlsProps {
  viewport: DesignViewport;
  zoom: { mode: 'fit' | 'manual'; value: number };
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

const PRESET_OPTIONS: Array<{ value: DesignViewportPreset; label: string }> = [
  { value: 'fill', label: '充满' },
  { value: 'desktop', label: '桌面 1280' },
  { value: 'tablet', label: '平板 768' },
  { value: 'mobile', label: '手机 390' },
  { value: 'custom', label: '自定义' },
];

const PRESET_WIDTH: Partial<Record<DesignViewportPreset, number>> = {
  desktop: 1280,
  tablet: 768,
  mobile: 390,
};

/**
 * 视口与缩放控件（P2 §3）：设备预设 / 自定义宽度（240–3840 整数，非法回退）、
 * 缩放 −/＋（步进 10%，夹 25%–200%）、百分比显示（双击回 100%）、
 * 「适应」在 fit/manual 间切换。fill 预设下缩放控件禁用（恒 scale 1）。
 * 持久化与归一化都在 controller 侧（setViewport / setZoom）。
 */
export function ViewportControls({
  viewport,
  zoom,
  onViewportChange,
  onZoomChange,
}: ViewportControlsProps) {
  const fill = viewport.preset === 'fill';
  const [widthText, setWidthText] = useState(() => String(viewport.width ?? ''));

  // 外部视口变化（含存储恢复、预设切换）时同步输入框显示。
  useEffect(() => {
    setWidthText(viewport.width === null ? '' : String(viewport.width));
  }, [viewport.preset, viewport.width]);

  const handlePresetChange = (preset: DesignViewportPreset) => {
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

  const zoomPercent = `${Math.round(zoom.value * 100)}%`;

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1">
      <Select
        value={viewport.preset}
        onChange={handlePresetChange}
        options={PRESET_OPTIONS}
        ariaLabel="视口预设"
        size="sm"
        className="w-28"
      />
      {!fill && (
        <Input
          aria-label="自定义宽度"
          inputMode="numeric"
          value={widthText}
          onChange={event => setWidthText(event.target.value)}
          onBlur={commitWidth}
          onKeyDown={event => {
            if (event.key === 'Enter') commitWidth();
          }}
          className="h-6 w-20 px-2 py-0 text-[11px]"
          placeholder="240–3840"
        />
      )}
      <div className="flex items-center gap-0.5">
        <Button
          size="sm"
          aria-label="缩小"
          disabled={fill || zoom.value <= ZOOM_MIN}
          onClick={() => onZoomChange({ mode: 'manual', value: clampZoom(zoom.value - ZOOM_STEP) })}
        >
          −
        </Button>
        <button
          type="button"
          aria-label={`缩放 ${zoomPercent}，双击复位`}
          title="双击复位到 100%"
          disabled={fill}
          onDoubleClick={() => onZoomChange({ mode: 'manual', value: 1 })}
          className="min-w-12 rounded px-1 text-center text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          {zoomPercent}
        </button>
        <Button
          size="sm"
          aria-label="放大"
          disabled={fill || zoom.value >= ZOOM_MAX}
          onClick={() => onZoomChange({ mode: 'manual', value: clampZoom(zoom.value + ZOOM_STEP) })}
        >
          ＋
        </Button>
        <Button
          size="sm"
          aria-label="适应宽度"
          aria-pressed={zoom.mode === 'fit'}
          variant={zoom.mode === 'fit' ? 'primary' : 'ghost'}
          disabled={fill}
          onClick={() =>
            onZoomChange(
              zoom.mode === 'fit'
                ? { mode: 'manual', value: zoom.value }
                : { mode: 'fit', value: zoom.value }
            )
          }
        >
          适应
        </Button>
      </div>
    </div>
  );
}
