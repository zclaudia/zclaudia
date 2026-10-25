export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 0.1;

export type DesignZoom = { mode: 'fit' | 'manual'; value: number };

export const clampZoom = (value: number): number =>
  // 步进 10%，夹在 25%–200%；避开二进制小数误差。
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));

/** Fit 模式步进用画布回报的实际比例；还没量到时才退回 zoom.value。 */
export function zoomAnchor(zoom: DesignZoom, actualScale?: number | null): number {
  if (zoom.mode === 'fit' && actualScale != null && actualScale > 0) return actualScale;
  return zoom.value;
}

export function stepZoom(
  zoom: DesignZoom,
  actualScale: number | null | undefined,
  direction: -1 | 1
): { mode: 'manual'; value: number } {
  return { mode: 'manual', value: clampZoom(zoomAnchor(zoom, actualScale) + direction * ZOOM_STEP) };
}
