import { useEffect, useMemo, useState } from 'react';
import type { UsageStatsPayload, UsageStatsRange } from '@zclaudia/shared';
import { getUsageStats } from '../../services/api';
import { useFacadeStore } from '../../stores/facadeStore';
import { LOCAL_BACKEND_KEY, resolveSessionBucketBackendId } from '../../stores/sessionsStore';
import { formatTokens } from '../../utils/formatTokens';
import { buildHeatmapWeeks, formatHour, funLine } from './usageStats';

const HEATMAP_WEEKS = 26;
const RANGES: UsageStatsRange[] = ['all', '30d', '7d'];
const RANGE_LABEL: Record<UsageStatsRange, string> = { all: 'All', '30d': '30d', '7d': '7d' };

/** Tailwind classes per heatmap intensity level (0..4). The heatmap is the
 *  panel's only color — data-viz exemption from the grayscale chrome rule. */
const LEVEL_CLASS = [
  'bg-border/60',
  'bg-primary/25',
  'bg-primary/45',
  'bg-primary/70',
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

  const line = funLine(stats.allTimeTokens);
  const cards: Array<{ label: string; value: string }> = [
    { label: 'Sessions', value: stats.sessions.toLocaleString('en-US') },
    { label: 'Messages', value: stats.messages.toLocaleString('en-US') },
    { label: 'Total tokens', value: formatTokens(stats.totalTokens) },
    { label: 'Active days', value: String(stats.activeDaysCount) },
    { label: 'Current streak', value: `${stats.currentStreakDays}d` },
    { label: 'Longest streak', value: `${stats.longestStreakDays}d` },
    ...(stats.peakHour !== null
      ? [{ label: 'Peak hour', value: formatHour(stats.peakHour) }]
      : []),
  ];

  return (
    <div className="mt-12 border-t border-border pt-5 px-2">
      <div className="flex items-center mb-3">
        <span className="text-[11px] font-medium text-muted-foreground">Usage</span>
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
      <div className="flex flex-wrap gap-2">
        {cards.map(c => (
          <div key={c.label} className="bg-secondary/50 rounded-lg px-3.5 py-2.5 min-w-[104px]">
            <span className="block text-[11px] text-muted-foreground">{c.label}</span>
            <span className="block mt-0.5 text-lg font-medium text-foreground">{c.value}</span>
          </div>
        ))}
      </div>
      <div
        data-testid="usage-heatmap"
        className="mt-4 grid [grid-template-rows:repeat(7,minmax(0,1fr))] grid-flow-col gap-[3px] w-fit"
      >
        {weeks.flat().map((cell, i) =>
          cell ? (
            <span
              key={cell.date}
              title={`${cell.date}: ${cell.count} ${cell.count === 1 ? 'message' : 'messages'}`}
              className={`h-[11px] w-[11px] rounded-[3px] ${LEVEL_CLASS[cell.level]}`}
            />
          ) : (
            <span key={`pad-${i}`} className="h-[11px] w-[11px]" />
          )
        )}
      </div>
      {line && <div className="mt-3 text-xs text-muted-foreground/60">{line}</div>}
    </div>
  );
}
