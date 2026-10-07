import { useMemo } from 'react';
import type {
  ModelUsagePayload,
  RuntimeUsagePayload,
  RuntimeUsageSeriesPoint,
} from '@zclaudia/shared/core/usage-stats';
import {
  addCacheSums,
  cacheHitRate,
  cacheInputTotal,
  emptyCacheSums,
  hasCacheActivity,
  type CacheTokenSums,
} from '@zclaudia/shared/core/cache-stats';
import { SECTION_LABEL } from '../../components/ui/typography';
import { CacheBreakdownBar } from '../../components/usage/CacheBreakdownBar';
import { formatHitRate, formatShare } from '../../components/usage/cacheFormat';
import { formatTokens } from '../../utils/formatTokens';
import { aggregateModelStats, aggregateRuntimeUsage } from './aggregateUsageStats';
import { prettyModelName } from './modelStats';
import { runtimeLabel } from './runtimeLabel';

/**
 * Cache tab (prompt cache stats plan, Phase 1d): the overall prompt-cache
 * picture over the same ledger capture as Overview / Models / Runtimes.
 * Hit rate = cache reads ÷ the whole input side, always recomputed from
 * merged sums.
 */
export function CacheView({
  runtimeSnapshots,
  modelSnapshots,
}: {
  runtimeSnapshots: Record<string, RuntimeUsagePayload | undefined>;
  modelSnapshots: Record<string, ModelUsagePayload | undefined>;
}) {
  const { merged } = useMemo(
    () =>
      aggregateRuntimeUsage(
        Object.entries(runtimeSnapshots).flatMap(([backendId, payload]) =>
          payload ? [{ backendId, name: backendId, payload }] : []
        )
      ),
    [runtimeSnapshots]
  );
  const models = useMemo(
    () =>
      aggregateModelStats(Object.values(modelSnapshots).filter((p): p is ModelUsagePayload => !!p)),
    [modelSnapshots]
  );
  const missingSources = Object.values(runtimeSnapshots).filter(p => !p).length;

  if (!merged) {
    return (
      <p className="py-4 text-xs text-muted-foreground/60">
        Cache stats are unavailable — no backend is reachable right now.
      </p>
    );
  }
  const cache = merged.totals.cache;
  if (!cache) {
    return (
      <p className="py-4 text-xs text-muted-foreground/60">Cache stats need an updated backend.</p>
    );
  }
  const total = cacheInputTotal(cache);
  if (total === 0) {
    return (
      <p className="py-4 text-xs text-muted-foreground/60">
        No cache data recorded in this range yet.
      </p>
    );
  }

  const runtimeRows = merged.runtimes
    .flatMap(row =>
      row.cache && cacheInputTotal(row.cache) > 0
        ? [{ key: row.runtimeId, label: runtimeLabel(row), cache: row.cache }]
        : []
    )
    .sort((a, b) => cacheInputTotal(b.cache) - cacheInputTotal(a.cache));
  const modelRows = (models?.models ?? [])
    .flatMap(model =>
      model.cache && cacheInputTotal(model.cache) > 0
        ? [
            {
              key: model.model,
              label: model.model === 'Unknown' ? 'Unknown' : prettyModelName(model.model),
              title: model.model,
              cache: model.cache,
            },
          ]
        : []
    )
    .sort((a, b) => cacheInputTotal(b.cache) - cacheInputTotal(a.cache));

  return (
    <div data-testid="cache-view">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          <span data-testid="cache-hit-rate" className="text-base font-medium text-foreground">
            {hasCacheActivity(cache) ? formatHitRate(cache) : '—'}
          </span>{' '}
          cache hit
        </span>
        <span>
          {formatTokens(cache.cacheRead)} of {formatTokens(total)} input tokens read from cache
        </span>
        {missingSources > 0 && (
          <span className="text-muted-foreground/60">
            {missingSources} backend{missingSources > 1 ? 's' : ''} without cache stats excluded
          </span>
        )}
      </div>
      {!hasCacheActivity(cache) && (
        <p className="mt-1 text-2xs text-muted-foreground/60">
          No cache activity — the providers used in this range reported no cache reads or writes.
        </p>
      )}

      <div className="mt-3">
        <CacheBreakdownBar sums={cache} />
      </div>

      <CacheHitChart series={merged.series} />

      <CacheTable title="By runtime" firstColumn="Runtime" rows={runtimeRows} />
      <CacheTable title="By model" firstColumn="Model" rows={modelRows} />

      <p className="mt-3 text-2xs text-muted-foreground/60">
        Cache hit = cache reads ÷ all input tokens (reads + writes + uncached). Only invocations
        that reported every bucket are counted; tokens are attributed to the day each invocation
        started.
      </p>
    </div>
  );
}

/** Daily hit-rate bars (0–100%), chunked to at most 60 columns like the Runtimes chart. */
function CacheHitChart({ series }: { series: RuntimeUsageSeriesPoint[] }) {
  const width = 560;
  const height = 80;
  const points = series.flatMap(point =>
    point.cache && cacheInputTotal(point.cache) > 0
      ? [{ date: point.date, cache: point.cache }]
      : []
  );
  if (points.length === 0) return null;
  const chunkSize = Math.max(1, Math.ceil(points.length / 60));
  const columns: Array<{ label: string; cache: CacheTokenSums }> = [];
  for (let i = 0; i < points.length; i += chunkSize) {
    const chunk = points.slice(i, i + chunkSize);
    columns.push({
      label:
        chunk.length === 1 ? chunk[0].date : `${chunk[0].date} – ${chunk[chunk.length - 1].date}`,
      cache: chunk.reduce((acc, point) => addCacheSums(acc, point.cache), emptyCacheSums()),
    });
  }
  const slot = width / columns.length;
  const barWidth = Math.max(1, Math.min(slot - 2, 24));
  return (
    <div className="mt-4">
      <span className={SECTION_LABEL}>Daily cache hit</span>
      <svg
        data-testid="cache-hit-chart"
        viewBox={`0 0 ${width} ${height}`}
        className="mt-1.5 w-full text-foreground"
        role="img"
        aria-label="Cache hit rate per day"
      >
        {columns.map((column, index) => {
          const rate = cacheHitRate(column.cache) ?? 0;
          const barHeight = Math.max(1, rate * height);
          const x = index * slot + (slot - barWidth) / 2;
          return (
            <g key={column.label}>
              <title>{`${column.label}: ${formatShare(rate)} cache hit · ${formatTokens(
                cacheInputTotal(column.cache)
              )} input`}</title>
              <rect
                x={x}
                y={0}
                width={barWidth}
                height={height}
                fill="currentColor"
                fillOpacity={0.06}
                rx={1}
              />
              <rect
                x={x}
                y={height - barHeight}
                width={barWidth}
                height={barHeight}
                fill="currentColor"
                fillOpacity={0.6}
                rx={1}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function CacheTable({
  title,
  firstColumn,
  rows,
}: {
  title: string;
  firstColumn: string;
  rows: Array<{ key: string; label: string; title?: string; cache: CacheTokenSums }>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-4">
      <span className={SECTION_LABEL}>{title}</span>
      <table className="mt-1 w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 font-normal">{firstColumn}</th>
            <th className="py-1 text-right font-normal">Cache hit</th>
            <th className="py-1 text-right font-normal">Read</th>
            <th className="py-1 text-right font-normal">Written</th>
            <th className="py-1 text-right font-normal">Uncached</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.key} className="border-t border-border/60">
              <td className="max-w-0 truncate py-1.5 font-medium text-foreground" title={row.title}>
                {row.label}
              </td>
              <td className="py-1.5 text-right">
                {hasCacheActivity(row.cache) ? formatHitRate(row.cache) : '—'}
              </td>
              <td className="py-1.5 text-right text-muted-foreground">
                {formatTokens(row.cache.cacheRead)}
              </td>
              <td className="py-1.5 text-right text-muted-foreground">
                {formatTokens(row.cache.cacheWrite)}
              </td>
              <td className="py-1.5 text-right text-muted-foreground">
                {formatTokens(row.cache.inputUncached)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
