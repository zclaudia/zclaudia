import type {
  CacheMissCause,
  CacheTimelineCall,
  SessionCacheTimeline,
} from '@zclaudia/shared/core/cache-stats';
import { cacheHitRate } from '@zclaudia/shared/core/cache-stats';
import { SECTION_LABEL } from '../ui/typography';
import { TONE_DOT, TONE_TEXT } from '../ui/tone';
import { CACHE_MISS_CAUSE_LABEL, formatShare } from './cacheFormat';

/** Distinct causes listed under the strip. */
const CAUSE_LIST_LIMIT = 4;

function isShortfall(call: CacheTimelineCall): boolean {
  return call.verdict === 'miss' || call.verdict === 'partial';
}

function describeCall(call: CacheTimelineCall): string {
  const reused = call.reuse === null ? 'first call' : `${formatShare(call.reuse)} reused`;
  return `Call ${call.callIndex + 1} · ${formatShare(cacheHitRate(call.tokens))} hit · ${reused}`;
}

/**
 * Per-call cache trace for one session: a bar per LLM call (height = that
 * call's hit rate, misses in the warning tone) and the latest shortfalls with
 * their likely cause. Renders nothing without traced calls.
 */
export function CacheTimeline({ timeline }: { timeline: SessionCacheTimeline }) {
  const { calls } = timeline;
  if (calls.length === 0) return null;
  // Group shortfalls by cause so a recurring cause isn't hidden behind the
  // latest few rows; each group keeps its most recent call as the example.
  const byCause = new Map<CacheMissCause, { count: number; latest: CacheTimelineCall }>();
  for (const call of calls.filter(isShortfall)) {
    for (const cause of call.causes.length > 0 ? call.causes : (['unknown'] as const)) {
      const group = byCause.get(cause);
      byCause.set(cause, { count: (group?.count ?? 0) + 1, latest: call });
    }
  }
  const causes = [...byCause.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[1].latest.at - a[1].latest.at)
    .slice(0, CAUSE_LIST_LIMIT);
  return (
    <div data-testid="cache-timeline" className="mt-2">
      <span className={SECTION_LABEL}>
        Last {calls.length} {calls.length === 1 ? 'call' : 'calls'}
      </span>
      <div
        className="mt-1 flex h-6 items-end gap-px"
        role="img"
        aria-label={`${calls.filter(isShortfall).length} of ${calls.length} calls missed the cache`}
      >
        {calls.map(call => {
          const rate = cacheHitRate(call.tokens) ?? 0;
          return (
            <span
              key={`${call.invocationId}:${call.callIndex}`}
              data-verdict={call.verdict}
              className={`min-w-0 flex-1 rounded-[1px] ${
                isShortfall(call) ? TONE_DOT.warning : 'bg-foreground/50'
              }`}
              style={{ height: `${Math.max(8, rate * 100)}%` }}
            />
          );
        })}
      </div>
      {causes.length > 0 ? (
        <ul className="mt-1.5 space-y-1">
          {causes.map(([cause, { count, latest }]) => (
            <li key={cause} data-testid="cache-miss-row" className="text-3xs">
              <span className={TONE_TEXT.warning}>
                {CACHE_MISS_CAUSE_LABEL[cause]}
                {count > 1 ? ` ×${count}` : ''}
              </span>
              <span className="block text-muted-foreground/60">
                Latest{' '}
                {new Date(latest.at).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}{' '}
                · {describeCall(latest)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-3xs text-muted-foreground/60">
          Every call reused the previous prompt.
        </p>
      )}
    </div>
  );
}
