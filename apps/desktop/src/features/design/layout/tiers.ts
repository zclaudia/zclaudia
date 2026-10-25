/**
 * 设计工作台的响应式档位原语（按容器实测宽度而非窗口断点）。
 * 阈值约定：>= 960 宽档，>= 640 中档，其余窄档；
 * 宽度 <= 0（未测量）按宽档兜底，> 0 且 < 360 视为紧凑宽度。
 */
export type DesignTier = 'wide' | 'medium' | 'narrow';

export const DESIGN_TIER_WIDE = 960;
export const DESIGN_TIER_MEDIUM = 640;
export const DESIGN_TIER_COMPACT = 360;

export function tierForWidth(width: number): DesignTier {
  if (width <= 0 || width >= DESIGN_TIER_WIDE) return 'wide';
  if (width >= DESIGN_TIER_MEDIUM) return 'medium';
  return 'narrow';
}

export function isCompactWidth(width: number): boolean {
  return width > 0 && width < DESIGN_TIER_COMPACT;
}
