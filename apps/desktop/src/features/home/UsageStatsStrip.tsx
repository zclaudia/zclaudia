import { useEffect, useMemo, useState } from 'react';
import type { UsageStatsPayload, UsageStatsRange } from '@zclaudia/shared';
import { getUsageStats } from '../../services/api';
import { useFacadeStore } from '../../stores/facadeStore';
import { LOCAL_BACKEND_KEY, resolveSessionBucketBackendId } from '../../stores/sessionsStore';
import { formatTokens } from '../../utils/formatTokens';
import {
  buildHeatmapWeeks,
  cardValueClass,
  flattenRowMajor,
  formatHour,
  funLine,
} from './usageStats';
import { prettyModelName } from './modelStats';
import { ModelsChart } from './ModelsChart';

const HEATMAP_WEEKS = 26;
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

/** Card-based all-time/windowed usage stats for the local backend. Renders
 *  nothing until the first load; keeps stale numbers during range refetches. */
export function UsageStatsStrip() {
  const localBackendId = useFacadeStore(s => s.localBackendId);
  const [range, setRange] = useState<UsageStatsRange>('all');
  const [tab, setTab] = useState<'overview' | 'models'>('overview');
  const [stats, setStats] = useState<UsageStatsPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    const backendId = resolveSessionBucketBackendId(LOCAL_BACKEND_KEY, localBackendId);
    getUsageStats(backendId, range)
      .then(next => {
        if (!cancelled) setStats(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [localBackendId, range]);

  const weeks = useMemo(
    () => (stats ? buildHeatmapWeeks(stats.activeDays, localToday(), HEATMAP_WEEKS) : []),
    [stats]
  );

  // Only a failed first fetch keeps the panel hidden; range switches keep
  // showing the previous payload until the new one lands.
  if (!stats) return null;

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
    <div className="mt-12 border-t border-border pt-5 px-2">
      <div className="flex items-center mb-3">
        <div className="flex gap-0.5">
          {(['overview', 'models'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
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
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
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
              exact same width as the cards above (26 = HEATMAP_WEEKS). */}
          <div
            data-testid="usage-heatmap"
            className="mt-4 grid grid-cols-[repeat(26,minmax(0,1fr))] gap-1"
          >
            {flattenRowMajor(weeks).map((cell, i) =>
              cell ? (
                <span
                  key={cell.date}
                  title={`${cell.date}: ${cell.count} ${cell.count === 1 ? 'message' : 'messages'}`}
                  className={`aspect-square w-full rounded-[4px] ${LEVEL_CLASS[cell.level]}`}
                />
              ) : (
                <span key={`pad-${i}`} className="aspect-square w-full" />
              )
            )}
          </div>
          {line && <div className="mt-3 text-xs text-muted-foreground/60">{line}</div>}
        </>
      ) : (
        <ModelsChart range={range} />
      )}
    </div>
  );
}
