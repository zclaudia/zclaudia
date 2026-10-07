import {
  cacheHitRate,
  type CacheMissCause,
  type CacheTokenSums,
} from '@zclaudia/shared/core/cache-stats';

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

export const CACHE_MISS_CAUSE_LABEL: Record<CacheMissCause, string> = {
  prompt_changed: 'System prompt changed',
  tools_changed: 'Tool set changed',
  model_changed: 'Model switched',
  thinking_changed: 'Thinking level changed',
  compaction: 'History compacted',
  history_trimmed: 'Old history trimmed to fit',
  history_rewritten: 'Earlier history changed',
  ttl_expired: 'Cache expired while idle',
  forked: 'Forked session starts cold',
  caching_disabled: 'Caching is off in the LLM profile',
  previous_turn_rewritten: "Previous run's messages were re-shaped",
  unknown: 'No visible cause',
};
