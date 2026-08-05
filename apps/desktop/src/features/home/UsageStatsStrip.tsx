import { useEffect, useMemo, useState } from 'react';
import type { UsageStatsPayload, UsageStatsRange } from '@zclaudia/shared';
import { getUsageStats } from '../../services/api';
import { useStatsBackendId } from './statsBackend';
import { formatTokens } from '../../utils/formatTokens';
import {
  buildHeatmapWeeks,
  cardValueClass,
  flattenRowMajor,
  formatHour,
  funLine,
  type HeatmapCell,
} from './usageStats';
import { prettyModelName } from './modelStats';
import { ModelsChart } from './ModelsChart';

const HEATMAP_WEEKS = 26;
/** Columns kept visible below md: — the older half hides so the remaining
 *  cells stay legible (and tappable) at phone widths. */
const HEATMAP_WEEKS_MOBILE = 13;
const RANGES: UsageStatsRange[] = ['all', '30d', '7d'];
const RANGE_LABEL: Record<UsageStatsRange, string> = { all: 'All', '30d': '30d', '7d': '7d' };

/** Tailwind classes per heatmap intensity level (0..4). The heatmap is the
 *  panel's only color — data-viz exemption from the grayscale chrome rule. */
const LEVEL_CLASS = [
  'bg-border/60',
  'bg-primary/30',
  'bg-primary/55',
  'bg-primary/80',
  'bg-primary',
];

function localToday(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 'YYYY-MM-DD' -> 'Jul 3, 2026' for the tapped-day caption. */
function formatDayLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Card-based all-time/windowed usage stats. Targets the local backend when
 *  one exists, otherwise the active backend (mobile / gateway-direct). Renders
 *  nothing until the first load; keeps stale numbers during range refetches. */
export function UsageStatsStrip() {
  const backendId = useStatsBackendId();
  const [range, setRange] = useState<UsageStatsRange>('all');
  const [tab, setTab] = useState<'overview' | 'models'>('overview');
  const [stats, setStats] = useState<UsageStatsPayload | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  // Tapped heatmap day, surfaced as an inline caption below the grid — the
  // touch-reachable counterpart to the desktop hover title.
  const [selectedDay, setSelectedDay] = useState<HeatmapCell | null>(null);

  useEffect(() => {
    setSelectedDay(null);
  }, [backendId, range]);

  useEffect(() => {
    let cancelled = false;
    if (backendId === null) {
      // No backend to ask (e.g. mobile before any backend connects).
      setUnavailable(true);
      return;
    }
    getUsageStats(backendId, range)
      .then(next => {
        if (cancelled) return;
        setStats(next);
        setUnavailable(false);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [backendId, range]);

  const weeks = useMemo(
    () => (stats ? buildHeatmapWeeks(stats.activeDays, localToday(), HEATMAP_WEEKS) : []),
    [stats]
  );

  // With no payload to show, a failed (or impossible) fetch surfaces a compact
  // notice instead of vanishing; once any payload has loaded, stale numbers
  // stay up during range refetches and transient failures.
  if (!stats) {
    if (unavailable) {
      return (
        <div className="mt-10 border-t border-border pt-5 px-2">
          <p className="text-xs text-muted-foreground/60">
            Usage stats are unavailable — no backend is reachable right now.
          </p>
        </div>
      );
    }
    // First fetch still in flight: stay blank rather than flashing a loader.
    return null;
  }

  // Guards double as version-skew protection: an older server (stale local
  // build or a remote backend behind on updates) omits the newer fields, and
  // those cards hide instead of rendering "undefined" / "NaN PM".
  const line = funLine(stats.allTimeTokens ?? stats.totalTokens, localToday());
  const cards: Array<{ label: string; value: string; title?: string }> = [
    { label: 'Sessions', value: stats.sessions.toLocaleString('en-US') },
    { label: 'Messages', value: stats.messages.toLocaleString('en-US') },
    { label: 'Total tokens', value: formatTokens(stats.totalTokens) },
    ...(typeof stats.activeDaysCount === 'number'
      ? [{ label: 'Active days', value: String(stats.activeDaysCount) }]
      : []),
    { label: 'Current streak', value: `${stats.currentStreakDays}d` },
    ...(typeof stats.longestStreakDays === 'number'
      ? [{ label: 'Longest streak', value: `${stats.longestStreakDays}d` }]
      : []),
    ...(typeof stats.peakHour === 'number'
      ? [{ label: 'Peak hour', value: formatHour(stats.peakHour) }]
      : []),
    ...(typeof stats.favoriteModel === 'string'
      ? [
          {
            label: 'Favorite model',
            value: prettyModelName(stats.favoriteModel),
            title: stats.favoriteModel,
          },
        ]
      : []),
  ];

  return (
    <div className="mt-10 border-t border-border pt-5 px-2">
      <div className="flex items-center mb-3">
        <div className="flex gap-0.5">
          {(['overview', 'models'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-xs px-2.5 py-2 md:py-1 rounded-md transition-colors ${
                t === tab
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'overview' ? 'Overview' : 'Models'}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-0.5">
          {RANGES.map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`text-xs px-2.5 py-2 md:py-1 rounded-md transition-colors ${
                r === range
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>
      {tab === 'overview' ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {cards.map(c => (
              <div key={c.label} className="bg-secondary/50 rounded-lg px-3.5 py-2.5">
                <span className="block text-[11px] text-muted-foreground">{c.label}</span>
                <span
                  title={c.title}
                  className={`block mt-0.5 font-medium text-foreground truncate ${cardValueClass(c.value)}`}
                >
                  {c.value}
                </span>
              </div>
            ))}
          </div>
          {/* Row-major grid with one fr column per week so the heatmap spans the
              exact same width as the cards above (26 = HEATMAP_WEEKS from md: up;
              below md: the older half of the columns hides, 13 = HEATMAP_WEEKS_MOBILE). */}
          <div
            data-testid="usage-heatmap"
            className="mt-4 grid grid-cols-[repeat(13,minmax(0,1fr))] md:grid-cols-[repeat(26,minmax(0,1fr))] gap-1"
          >
            {flattenRowMajor(weeks).map((cell, i) => {
              // Week index within the row (row-major flatten). Cells in the older
              // half only exist from md: up, matching the responsive column count.
              const olderHalf = i % HEATMAP_WEEKS < HEATMAP_WEEKS - HEATMAP_WEEKS_MOBILE;
              const responsive = olderHalf ? ' hidden md:block' : '';
              if (!cell) {
                return <span key={`pad-${i}`} className={`aspect-square w-full${responsive}`} />;
              }
              const label = `${cell.date}: ${cell.count} ${cell.count === 1 ? 'message' : 'messages'}`;
              return (
                <button
                  key={cell.date}
                  type="button"
                  title={label}
                  aria-label={label}
                  onClick={() =>
                    setSelectedDay(prev => (prev?.date === cell.date ? null : cell))
                  }
                  className={`aspect-square w-full rounded-[4px] ${LEVEL_CLASS[cell.level]}${responsive}`}
                />
              );
            })}
          </div>
          {selectedDay && (
            <div
              data-testid="heatmap-day-caption"
              className="mt-2 text-xs text-muted-foreground md:hidden"
            >
              {formatDayLabel(selectedDay.date)} · {selectedDay.count}{' '}
              {selectedDay.count === 1 ? 'message' : 'messages'}
            </div>
          )}
          {line && <div className="mt-3 text-xs text-muted-foreground/60">{line}</div>}
        </>
      ) : (
        <ModelsChart range={range} />
      )}
    </div>
  );
}
