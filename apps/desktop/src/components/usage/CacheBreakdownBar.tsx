import { cacheShares, type CacheTokenSums } from '@zclaudia/shared/core/cache-stats';
import { formatTokens } from '../../utils/formatTokens';
import { formatShare } from './cacheFormat';

/** Grayscale steps: reads (the hits) darkest, uncached lightest. */
const SEGMENTS = [
  { key: 'read', label: 'Read', opacity: 0.85 },
  { key: 'write', label: 'Written', opacity: 0.45 },
  { key: 'uncached', label: 'Uncached', opacity: 0.15 },
] as const;

function tokensOf(sums: CacheTokenSums, key: (typeof SEGMENTS)[number]['key']): number {
  return key === 'read' ? sums.cacheRead : key === 'write' ? sums.cacheWrite : sums.inputUncached;
}

/**
 * Input-side split of prompt tokens into cache reads / cache writes /
 * uncached, as a proportional bar plus a token + share legend. Renders
 * nothing for an empty input side.
 */
export function CacheBreakdownBar({
  sums,
  compact = false,
}: {
  sums: CacheTokenSums;
  compact?: boolean;
}) {
  const shares = cacheShares(sums);
  if (!shares) return null;
  return (
    <div data-testid="cache-breakdown">
      <div
        className={`flex w-full overflow-hidden rounded-full bg-secondary text-foreground ${
          compact ? 'h-1.5' : 'h-2'
        }`}
        role="img"
        aria-label={SEGMENTS.map(s => `${s.label} ${formatShare(shares[s.key])}`).join(', ')}
      >
        {SEGMENTS.map(s =>
          shares[s.key] > 0 ? (
            <span
              key={s.key}
              className="h-full bg-current"
              style={{ width: `${shares[s.key] * 100}%`, opacity: s.opacity }}
            />
          ) : null
        )}
      </div>
      <div
        className={`mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground ${
          compact ? 'text-3xs' : 'text-2xs'
        }`}
      >
        {SEGMENTS.map(s => (
          <span key={s.key} className="inline-flex items-center gap-1 whitespace-nowrap">
            <span
              aria-hidden
              className="inline-block size-1.5 rounded-full bg-foreground"
              style={{ opacity: s.opacity }}
            />
            {s.label} {formatShare(shares[s.key])}
            <span className="text-muted-foreground/60">{formatTokens(tokensOf(sums, s.key))}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
