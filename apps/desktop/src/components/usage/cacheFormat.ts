import { cacheHitRate, type CacheTokenSums } from '@zclaudia/shared/core/cache-stats';

/** Whole-percent label; tiny non-zero shares read "<1%" instead of a false 0%. */
export function formatShare(rate: number | null): string {
  if (rate === null) return '—';
  if (rate > 0 && rate < 0.01) return '<1%';
  if (rate < 1 && rate > 0.99) return '>99%';
  return `${Math.round(rate * 100)}%`;
}

/** Hit-rate label for a set of cache sums ('—' when nothing was recorded). */
export function formatHitRate(sums: CacheTokenSums | undefined | null): string {
  return formatShare(cacheHitRate(sums));
}
