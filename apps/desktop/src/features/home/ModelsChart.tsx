import { useEffect, useMemo, useState } from 'react';
import type { ModelUsagePayload, UsageStatsRange } from '@zclaudia/shared';
import { getModelStats } from '../../services/api';
import { useFacadeStore } from '../../stores/facadeStore';
import { LOCAL_BACKEND_KEY, resolveSessionBucketBackendId } from '../../stores/sessionsStore';
import { formatTokens } from '../../utils/formatTokens';
import { buildModelChart, prettyModelName } from './modelStats';

const LEGEND_LIMIT = 5;
/** Share-rank fill opacities; ranks past the ladder reuse the last step. */
const RANK_OPACITY = [1, 0.8, 0.6, 0.45, 0.3, 0.2];

const CHART_W = 560;
const CHART_H = 150;
const AXIS_W = 36;
const LABEL_H = 16;

function formatDay(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Per-model stacked daily usage for the local backend. Same fetch semantics
 *  as the cards: silent failure, stale data kept during range refetches. */
export function ModelsChart({ range }: { range: UsageStatsRange }) {
  const localBackendId = useFacadeStore(s => s.localBackendId);
  const [stats, setStats] = useState<ModelUsagePayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    const backendId = resolveSessionBucketBackendId(LOCAL_BACKEND_KEY, localBackendId);
    getModelStats(backendId, range)
      .then(next => {
        if (!cancelled) setStats(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [localBackendId, range]);

  const [expanded, setExpanded] = useState(false);
  const chart = useMemo(
    () =>
      stats
        ? buildModelChart(
            stats.days,
            stats.models.map(m => m.model)
          )
        : null,
    [stats]
  );

  if (!stats || !chart) return null;

  if (stats.models.length === 0) {
    return (
      <p className="py-6 text-xs text-muted-foreground/60">
        No model data yet. New messages record their model automatically.
      </p>
    );
  }

  const rankOf = new Map(stats.models.map((m, i) => [m.model, i]));
  const opacityFor = (model: string) =>
    RANK_OPACITY[Math.min(rankOf.get(model) ?? RANK_OPACITY.length - 1, RANK_OPACITY.length - 1)];

  const plotW = CHART_W - AXIS_W;
  const plotH = CHART_H - LABEL_H;
  const slot = plotW / chart.bars.length;
  const barW = Math.max(2, Math.min(14, slot * 0.7));
  const yFor = (tokens: number) =>
    chart.scaleMax > 0 ? plotH - (tokens / chart.scaleMax) * (plotH - 8) : plotH;

  // At most ~4 x-axis labels, evenly spaced across the window.
  const labelEvery = Math.max(1, Math.ceil(chart.bars.length / 4));

  const legend = expanded ? stats.models : stats.models.slice(0, LEGEND_LIMIT);
  const hiddenCount = stats.models.length - LEGEND_LIMIT;

  return (
    <div>
      <svg
        data-testid="models-chart-svg"
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="w-full h-auto text-primary"
      >
        {chart.ticks.map(tick => (
          <g key={tick}>
            <text
              x={AXIS_W - 6}
              y={yFor(tick) + 3}
              textAnchor="end"
              className="fill-muted-foreground/60 text-[9px]"
            >
              {formatTokens(tick)}
            </text>
            <line
              x1={AXIS_W}
              y1={yFor(tick)}
              x2={CHART_W}
              y2={yFor(tick)}
              className="stroke-border"
              strokeWidth="0.5"
            />
          </g>
        ))}
        {chart.bars.map((bar, i) => {
          let cursor = yFor(0);
          const x = AXIS_W + i * slot + (slot - barW) / 2;
          return (
            <g key={bar.date}>
              {bar.segments.map(seg => {
                const height = yFor(0) - yFor(seg.value);
                cursor -= height;
                return (
                  <rect
                    key={seg.model}
                    x={x}
                    y={cursor}
                    width={barW}
                    height={Math.max(height - 0.5, 0)}
                    rx="1.5"
                    fill="currentColor"
                    fillOpacity={opacityFor(seg.model)}
                  >
                    <title>{`${bar.date}: ${formatTokens(bar.total)}`}</title>
                  </rect>
                );
              })}
              {i % labelEvery === 0 && (
                <text
                  x={x + barW / 2}
                  y={CHART_H - 3}
                  textAnchor="middle"
                  className="fill-muted-foreground/60 text-[9px]"
                >
                  {formatDay(bar.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="mt-3 border-t border-border pt-2">
        {legend.map(m => (
          <div key={m.model} className="flex items-center gap-2 py-1 text-sm">
            <span
              className="h-2.5 w-2.5 rounded-[3px] bg-primary shrink-0"
              style={{ opacity: opacityFor(m.model) }}
            />
            <span className="text-foreground truncate" title={m.model}>
              {prettyModelName(m.model)}
            </span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground/60">
              {formatTokens(m.inTokens)} in · {formatTokens(m.outTokens)} out
            </span>
            <span className="w-14 shrink-0 text-right text-xs text-muted-foreground">
              {(m.share * 100).toFixed(1)}%
            </span>
          </div>
        ))}
        {!expanded && hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="py-1 text-xs text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            Show {hiddenCount} more
          </button>
        )}
      </div>

      {stats.trackedSince !== null && (
        <p className="mt-3 text-xs text-muted-foreground/60">
          Model tracking started{' '}
          {new Date(stats.trackedSince).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}{' '}
          — earlier usage is not attributed.
        </p>
      )}
    </div>
  );
}
