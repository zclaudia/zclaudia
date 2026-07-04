import { useEffect, useMemo, useState } from 'react';
import type { UsageStatsPayload } from '@zclaudia/shared';
import { getUsageStats } from '../../services/api';
import { useFacadeStore } from '../../stores/facadeStore';
import { LOCAL_BACKEND_KEY, resolveSessionBucketBackendId } from '../../stores/sessionsStore';
import { formatTokens } from '../../utils/formatTokens';
import { buildHeatmapWeeks, funLine } from './usageStats';

const HEATMAP_WEEKS = 26;

/** Tailwind classes per heatmap intensity level (0..4). The heatmap is the
 *  strip's only color — data-viz exemption from the grayscale chrome rule. */
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

/** Compact all-time usage stats for the local backend. Renders nothing until
 *  loaded; stays hidden on fetch errors and when there is no activity. */
export function UsageStatsStrip() {
  const localBackendId = useFacadeStore(s => s.localBackendId);
  const [stats, setStats] = useState<UsageStatsPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    const backendId = resolveSessionBucketBackendId(LOCAL_BACKEND_KEY, localBackendId);
    getUsageStats(backendId)
      .then(next => {
        if (!cancelled) setStats(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [localBackendId]);

  const weeks = useMemo(
    () => (stats ? buildHeatmapWeeks(stats.activeDays, localToday(), HEATMAP_WEEKS) : []),
    [stats]
  );

  // A sessions-only database has nothing worth charting — hide until the
  // first message exists.
  if (!stats || stats.messages === 0) return null;

  const line = funLine(stats.totalTokens);
  const numbers: Array<{ value: string; label: string }> = [
    { value: String(stats.sessions), label: 'Sessions' },
    { value: stats.messages.toLocaleString('en-US'), label: 'Messages' },
    { value: formatTokens(stats.totalTokens), label: 'Tokens' },
    { value: `${stats.currentStreakDays}d`, label: 'Streak' },
  ];

  return (
    <div className="mt-12 border-t border-border pt-6 px-2">
      <div className="flex flex-wrap items-start gap-x-7 gap-y-2">
        {numbers.map(n => (
          <div key={n.label} className="flex flex-col gap-0.5">
            <span className="text-base font-medium text-muted-foreground">{n.value}</span>
            <span className="text-[11px] text-muted-foreground/60">{n.label}</span>
          </div>
        ))}
      </div>
      <div
        data-testid="usage-heatmap"
        className="mt-3.5 grid [grid-template-rows:repeat(7,minmax(0,1fr))] grid-flow-col gap-[2px] w-fit"
      >
        {weeks.flat().map((cell, i) =>
          cell ? (
            <span
              key={cell.date}
              title={`${cell.date}: ${cell.count} ${cell.count === 1 ? 'message' : 'messages'}`}
              className={`h-2 w-2 rounded-[2px] ${LEVEL_CLASS[cell.level]}`}
            />
          ) : (
            <span key={`pad-${i}`} className="h-2 w-2" />
          )
        )}
      </div>
      {line && <div className="mt-3 text-xs text-muted-foreground/60">{line}</div>}
    </div>
  );
}
