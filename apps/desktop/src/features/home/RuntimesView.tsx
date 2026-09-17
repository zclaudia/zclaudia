import { Fragment, useEffect, useMemo, useState } from 'react';
import type {
  RuntimeUsagePayload,
  RuntimeUsageRuntimeRow,
  UsageStatsRange,
} from '@zclaudia/shared';
import { getRuntimeUsage } from '../../services/api';
import { useStatsBackendTargets } from './statsBackend';
import { aggregateRuntimeUsage, type BackendRuntimeUsage } from './aggregateUsageStats';
import { formatTokens } from '../../utils/formatTokens';

/**
 * Runtimes tab (runtime usage design §9): the ledger view shared with the
 * Overview coverage line and the Models chart. Token shares describe the
 * RECORDED data only — runtimes differ in models, tasks and cache behavior,
 * so the table never ranks "efficiency".
 */

const RUNTIME_LABEL_FALLBACK: Record<string, string> = {
  pi: 'Pi',
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  legacy: 'Legacy (unknown source)',
};

function runtimeLabel(row: RuntimeUsageRuntimeRow): string {
  return row.runtimeLabel ?? RUNTIME_LABEL_FALLBACK[row.runtimeId] ?? row.runtimeId;
}

/** Stacked daily bars, one segment per runtime (custom SVG like ModelsChart). */
function RuntimeSeriesChart({ series }: { series: RuntimeUsagePayload['series'] }) {
  const width = 560;
  const height = 120;
  // Preserve the whole selected range. Group adjacent dates into at most 60
  // columns instead of silently dropping all but the newest 60 days.
  const chunkSize = Math.max(1, Math.ceil(series.length / 60));
  const ordered: RuntimeUsagePayload['series'] = [];
  for (let i = 0; i < series.length; i += chunkSize) {
    const chunk = series.slice(i, i + chunkSize);
    const runtimes: Record<string, number> = {};
    for (const point of chunk) {
      for (const [id, tokens] of Object.entries(point.runtimes)) {
        runtimes[id] = (runtimes[id] ?? 0) + tokens;
      }
    }
    ordered.push({
      date:
        chunk.length === 1 ? chunk[0].date : `${chunk[0].date} – ${chunk[chunk.length - 1].date}`,
      runtimes,
    });
  }
  const slot = width / Math.max(ordered.length, 1);
  const barWidth = Math.max(1, slot - 2);
  const maxDay = Math.max(
    0,
    ...ordered.map(point => Object.values(point.runtimes).reduce((a, b) => a + b, 0))
  );
  if (ordered.length === 0 || maxDay === 0) return null;

  return (
    <svg
      data-testid="runtime-usage-chart"
      viewBox={`0 0 ${width} ${height}`}
      className="mt-3 w-full"
      role="img"
      aria-label="Recorded tokens per day by runtime"
    >
      {ordered.map((point, index) => {
        const x = index * slot;
        let yOffset = height;
        const dayTotal = Object.values(point.runtimes).reduce((a, b) => a + b, 0);
        return (
          <g key={point.date}>
            <title>{`${point.date}: ${formatTokens(dayTotal)}`}</title>
            {Object.entries(point.runtimes).map(([runtimeId, tokens]) => {
              const segmentHeight = Math.max(1, (tokens / maxDay) * height);
              yOffset -= segmentHeight;
              return (
                <rect
                  key={runtimeId}
                  x={x}
                  y={yOffset}
                  width={barWidth}
                  height={segmentHeight}
                  fill="currentColor"
                  fillOpacity={runtimeOpacity(runtimeId)}
                  rx={1}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

function runtimeOpacity(runtimeId: string): number {
  switch (runtimeId) {
    case 'claude':
      return 1;
    case 'codex':
      return 0.7;
    case 'cursor':
      return 0.5;
    case 'pi':
      return 0.4;
    default:
      return 0.3;
  }
}

function coverageLabel(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

function tokensOrDash(value: number | null): string {
  // '—' only when nothing was recorded; a real 0 stays a 0.
  return value === null ? '—' : formatTokens(value);
}

/**
 * The Runtimes tab content. Fetches the ledger payload from every online
 * backend with the same asOf/timeZone, dedupes identical datasets, and shows
 * per-source coverage honestly: an unreachable backend is missing from "N/M
 * sources", never silently dropped.
 */
export function RuntimesView({ range }: { range: UsageStatsRange }) {
  const targets = useStatsBackendTargets();
  const targetKey = targets.map(t => t.backendId).join(',');
  const [perBackend, setPerBackend] = useState<BackendRuntimeUsage[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPerBackend([]);
    setLoaded(false);
    // One pinned snapshot instant for every backend in this merge.
    const asOf = Date.now();
    Promise.all(
      targets.map(target =>
        getRuntimeUsage(target.backendId, range, { asOf })
          .then(payload => ({ backendId: target.backendId, name: target.name, payload }))
          .catch(() => null)
      )
    ).then(results => {
      if (cancelled) return;
      const usable = results.filter((r): r is BackendRuntimeUsage => r !== null);
      setPerBackend(usable);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, range]);

  const { merged, deduplicated } = useMemo(() => aggregateRuntimeUsage(perBackend), [perBackend]);

  const [expandedRuntime, setExpandedRuntime] = useState<string | null>(null);

  if (!merged) {
    if (!loaded) return null;
    return (
      <p className="py-4 text-xs text-muted-foreground/60">
        Runtime usage is unavailable — no backend is reachable right now.
      </p>
    );
  }

  const accountingSinceLabel =
    merged.accountingSince !== null
      ? new Date(merged.accountingSince).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : null;
  const inFlight = merged.coverage.inFlight;
  const inFlightTokens = merged.totals.activeRecordedTokens;

  return (
    <div data-testid="runtimes-view">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">
            {tokensOrDash(merged.totals.recordedTokens)}
          </span>{' '}
          recorded tokens
          {merged.accountingActive ? '' : ' (ledger inactive on this backend)'}
        </span>
        <span>
          fully reported{' '}
          <span className="font-medium text-foreground">{coverageLabel(merged.coverage.rate)}</span>
          {merged.coverage.missing > 0 ? ` · ${merged.coverage.missing} missing` : ''}
          {merged.coverage.partial > 0 ? ` · ${merged.coverage.partial} partial` : ''}
        </span>
        {targets.length > 1 && (
          <span>
            received {perBackend.length}/{targets.length} sources
            {deduplicated > 0 ? ` (${deduplicated} duplicate datasets skipped)` : ''}
          </span>
        )}
      </div>
      {(merged.totals.legacyTokens !== null || inFlight > 0) && (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground/70">
          {merged.totals.legacyTokens !== null && (
            <span>historical records {formatTokens(merged.totals.legacyTokens)}</span>
          )}
          {inFlight > 0 && (
            <span>
              {inFlight} invocation{inFlight > 1 ? 's' : ''} running
              {inFlightTokens !== null ? ` (reported so far ${formatTokens(inFlightTokens)})` : ''}
            </span>
          )}
        </div>
      )}
      {accountingSinceLabel && (
        <p className="mt-1 text-[11px] text-muted-foreground/50">
          Completeness tracked since {accountingSinceLabel}; earlier usage is historical data that
          cannot be verified. Tokens are attributed to the day each invocation started.
        </p>
      )}

      <RuntimeSeriesChart series={merged.series} />

      <table className="mt-3 w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 font-normal">Runtime</th>
            <th className="py-1 text-right font-normal">Recorded tokens</th>
            <th className="py-1 text-right font-normal">In / Out</th>
            <th className="py-1 text-right font-normal">Fully reported</th>
            <th className="py-1 text-right font-normal">Calls</th>
          </tr>
        </thead>
        <tbody>
          {merged.runtimes.map(row => {
            const label = runtimeLabel(row);
            const expanded = expandedRuntime === row.runtimeId;
            const inOut =
              row.inputTokens === null && row.outputTokens === null
                ? '—'
                : `${tokensOrDash(row.inputTokens)} / ${tokensOrDash(row.outputTokens)}`;
            return (
              <Fragment key={row.runtimeId}>
                <tr
                  className="border-t border-border/60 cursor-pointer hover:bg-secondary/40"
                  onClick={() =>
                    setExpandedRuntime(prev => (prev === row.runtimeId ? null : row.runtimeId))
                  }
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setExpandedRuntime(prev => (prev === row.runtimeId ? null : row.runtimeId));
                    }
                  }}
                  tabIndex={0}
                  aria-expanded={expanded}
                >
                  <td className="py-1.5 font-medium text-foreground">
                    {label}
                    {row.inFlightCalls > 0 && (
                      <span className="ml-1.5 text-[10px] text-muted-foreground/60">
                        +{row.inFlightCalls} running
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right">{tokensOrDash(row.recordedTokens)}</td>
                  <td className="py-1.5 text-right text-muted-foreground">{inOut}</td>
                  <td className="py-1.5 text-right">{coverageLabel(row.coverageRate)}</td>
                  <td className="py-1.5 text-right text-muted-foreground">{row.calls || '—'}</td>
                </tr>
                {expanded && (
                  <tr className="border-t border-border/40 bg-secondary/20">
                    <td colSpan={5} className="px-2 py-2">
                      <RuntimeDetail row={row} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {merged.runtimes.length === 0 && (
            <tr>
              <td colSpan={5} className="py-3 text-center text-muted-foreground/60">
                No invocations recorded in this range yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RuntimeDetail({ row }: { row: RuntimeUsageRuntimeRow }) {
  const detailBits: string[] = [
    `${row.completeCalls} complete`,
    `${row.partialCalls} partial`,
    `${row.missingCalls} missing`,
  ];
  if (row.legacyCalls > 0) detailBits.push(`${row.legacyCalls} legacy`);
  if (row.inFlightCalls > 0) detailBits.push(`${row.inFlightCalls} running`);
  return (
    <div className="space-y-1 text-[11px] text-muted-foreground">
      {row.runtimeId === 'cursor' && row.missingCalls === row.calls && row.calls > 0 && (
        <p>No token usage reported by this version of Cursor.</p>
      )}
      <p>{detailBits.join(' · ')}</p>
      {row.models.length > 0 && (
        <div>
          <span className="text-muted-foreground/70">Models: </span>
          {row.models.map(model => (
            <span key={model.modelId ?? '__unknown__'} className="mr-2 whitespace-nowrap">
              {model.modelId ?? 'Unknown'} · {formatTokens(model.tokens)}
            </span>
          ))}
        </div>
      )}
      <p className="text-muted-foreground/50">
        Shares describe recorded data only — runtimes differ in models, tasks and caching.
      </p>
    </div>
  );
}
