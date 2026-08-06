import { useEffect, useMemo, useState } from 'react';
import type { ModelUsagePayload, UsageStatsRange } from '@zclaudia/shared';
import { getModelStats } from '../../services/api';
import { useStatsBackendTargets } from './statsBackend';
import { aggregateModelStats } from './aggregateUsageStats';
import { formatTokens } from '../../utils/formatTokens';
import { buildModelChart, prettyModelName } from './modelStats';
import { useIsMobile } from '../../hooks/useMediaQuery';

const LEGEND_LIMIT = 5;
/** Share-rank fill opacities; ranks past the ladder reuse the last step. */
const RANK_OPACITY = [1, 0.8, 0.6, 0.45, 0.3, 0.2];

const CHART_W = 560;
/** Narrower viewBox below md: — the SVG still fills the container, so the
 *  9px-in-viewBox-units labels render near actual size instead of ~5px. */
const CHART_W_MOBILE = 320;
const CHART_H = 150;
const AXIS_W = 36;
const LABEL_H = 16;

function formatDay(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Per-model stacked daily usage. Same backend targeting and fetch semantics
 *  as the cards: shared stats backend, visible failure notice, stale data kept
 *  during range refetches. */
export function ModelsChart({ range }: { range: UsageStatsRange }) {
  const targets = useStatsBackendTargets();
  const targetKey = targets.map(t => t.backendId).join(',');
  const isMobile = useIsMobile();
  const [stats, setStats] = useState<ModelUsagePayload | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (targets.length === 0) {
      setUnavailable(true);
      return;
    }
    // Totalled across backends, matching the cards above; a backend that fails
    // drops out instead of failing the chart.
    Promise.all(targets.map(target => getModelStats(target.backendId, range).catch(() => null)))
      .then(results => {
        if (cancelled) return;
        const usable = results.filter((r): r is ModelUsagePayload => r !== null);
        setUnavailable(usable.length === 0);
        const merged = aggregateModelStats(usable);
        if (merged) setStats(merged);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, range]);

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

  if (!stats || !chart) {
    if (unavailable) {
      return (
        <p className="py-6 text-xs text-muted-foreground/60">
          Model stats are unavailable — no backend is reachable right now.
        </p>
      );
    }
    return null;
  }

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

  const chartW = isMobile ? CHART_W_MOBILE : CHART_W;
  const plotW = chartW - AXIS_W;
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
        viewBox={`0 0 ${chartW} ${CHART_H}`}
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
              x2={chartW}
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
            {/* Name grows into the free space but never below 40% of the row;
                past that point the in/out span shrinks and truncates instead,
                so narrow rows keep the model name readable. */}
            <span className="flex-1 min-w-[40%] text-foreground truncate" title={m.model}>
              {prettyModelName(m.model)}
            </span>
            <span className="min-w-0 truncate text-right text-xs text-muted-foreground/60">
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
