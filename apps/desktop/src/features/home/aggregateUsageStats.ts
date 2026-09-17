import type {
  AccountingSummary,
  ModelUsagePayload,
  RuntimeUsagePayload,
  UsageActiveDay,
  UsageStatsPayload,
  UsageStatsRange,
} from '@zclaudia/shared';

export interface BackendUsage {
  backendId: string;
  name: string;
  stats: UsageStatsPayload;
}

/** Merge per-day counts from every backend into one ascending series. */
function mergeActiveDays(all: UsageStatsPayload[]): UsageActiveDay[] {
  const byDate = new Map<string, number>();
  for (const stats of all) {
    for (const day of stats.activeDays) {
      byDate.set(day.date, (byDate.get(day.date) ?? 0) + day.count);
    }
  }
  return [...byDate.entries()]
    .filter(([, count]) => count > 0)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + delta);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Longest run of consecutive dates in an ascending, deduped series. */
function longestStreak(dates: string[]): number {
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const date of dates) {
    run = prev && addDays(prev, 1) === date ? run + 1 : 1;
    if (run > best) best = run;
    prev = date;
  }
  return best;
}

/** Consecutive active days ending today (or yesterday — today may be empty). */
function currentStreak(dates: string[], today: string): number {
  const set = new Set(dates);
  let cursor = set.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/**
 * Combine several backends' usage into one payload.
 *
 * Counters sum. Day-derived figures (active days, streaks) are recomputed from
 * the merged daily series rather than summed — the same calendar day worked on
 * two machines is one active day, and streaks can bridge across backends.
 * peakHour/favoriteModel have no cross-backend meaning, so they come from the
 * heaviest contributor by tokens.
 */
export function aggregateUsageStats(
  entries: BackendUsage[],
  today: string,
  range: UsageStatsRange
): UsageStatsPayload | null {
  const seen = new Set<string>();
  entries = entries.filter(e => {
    const id = e.stats.datasetId;
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (entries.length === 0) return null;
  if (entries.length === 1) return entries[0].stats;

  const all = entries.map(e => e.stats);
  // activeDays is always the full 182-day heatmap window, but activeDaysCount
  // and longestStreakDays are range-scoped, so recompute those from the days
  // inside the range. currentStreakDays is range-independent by definition.
  const activeDays = mergeActiveDays(all);
  const dates = activeDays.map(d => d.date);
  const windowDays = range === '7d' ? 7 : range === '30d' ? 30 : null;
  const cutoff = windowDays === null ? null : addDays(today, -(windowDays - 1));
  const inRange = cutoff === null ? dates : dates.filter(d => d >= cutoff);
  const heaviest = entries.reduce((best, e) =>
    e.stats.totalTokens > best.stats.totalTokens ? e : best
  ).stats;
  // A mixed-version set has no trustworthy global coverage denominator.
  const accounting = all.every(s => s.accounting)
    ? mergeAccounting(all.map(s => s.accounting).filter((s): s is AccountingSummary => !!s))
    : undefined;

  return {
    sessions: all.reduce((n, s) => n + s.sessions, 0),
    messages: all.reduce((n, s) => n + s.messages, 0),
    totalTokens: all.reduce((n, s) => n + s.totalTokens, 0),
    allTimeTokens: all.reduce((n, s) => n + s.allTimeTokens, 0),
    activeDaysCount: inRange.length,
    currentStreakDays: currentStreak(dates, today),
    longestStreakDays: longestStreak(inRange),
    peakHour: heaviest.peakHour,
    favoriteModel: heaviest.favoriteModel,
    activeDays,
    capturedAt: Math.max(...all.map(s => s.capturedAt)),
    ...(accounting ? { accounting } : {}),
  };
}

/**
 * Merge ledger accounting summaries: values sum, coverage percentages
 * recompute from merged numerators/denominators (never averaged), and the
 * accounting start date is the earliest activation across backends.
 */
function mergeAccounting(summaries: AccountingSummary[]): AccountingSummary | undefined {
  if (summaries.length === 0) return undefined;
  const recordedValues = summaries
    .map(s => s.recordedTokens)
    .filter((v): v is number => v !== null);
  const sinceValues = summaries
    .map(s => s.accountingSince)
    .filter((v): v is number => typeof v === 'number');
  return {
    active: true,
    recordedTokens: recordedValues.length > 0 ? recordedValues.reduce((a, b) => a + b, 0) : null,
    completeCalls: summaries.reduce((n, s) => n + s.completeCalls, 0),
    partialCalls: summaries.reduce((n, s) => n + s.partialCalls, 0),
    missingCalls: summaries.reduce((n, s) => n + s.missingCalls, 0),
    eligibleFinalized: summaries.reduce((n, s) => n + s.eligibleFinalized, 0),
    inFlightCalls: summaries.reduce((n, s) => n + s.inFlightCalls, 0),
    legacyRecords: summaries.reduce((n, s) => n + s.legacyRecords, 0),
    accountingSince: sinceValues.length > 0 ? Math.min(...sinceValues) : null,
  };
}

/**
 * Combine several backends' per-model usage. Days merge per date+model and
 * totals merge per model; shares are recomputed against the merged grand total
 * so the legend still sums to 100%.
 */
export function aggregateModelStats(all: ModelUsagePayload[]): ModelUsagePayload | null {
  const seen = new Set<string>();
  all = all.filter(p => {
    if (!p.datasetId) return true;
    if (seen.has(p.datasetId)) return false;
    seen.add(p.datasetId);
    return true;
  });
  if (all.length === 0) return null;
  if (all.length === 1) return all[0];

  const byDate = new Map<string, Record<string, number>>();
  for (const payload of all) {
    for (const day of payload.days) {
      const models = byDate.get(day.date) ?? {};
      for (const [model, tokens] of Object.entries(day.models)) {
        models[model] = (models[model] ?? 0) + tokens;
      }
      byDate.set(day.date, models);
    }
  }

  const totals = new Map<string, { inTokens: number; outTokens: number; totalTokens: number }>();
  for (const payload of all) {
    for (const model of payload.models) {
      const acc = totals.get(model.model) ?? { inTokens: 0, outTokens: 0, totalTokens: 0 };
      acc.inTokens += model.inTokens;
      acc.outTokens += model.outTokens;
      acc.totalTokens += model.totalTokens;
      totals.set(model.model, acc);
    }
  }
  const grandTotal = [...totals.values()].reduce((n, m) => n + m.totalTokens, 0);
  const trackedSinceValues = all
    .map(p => p.trackedSince)
    .filter((v): v is number => typeof v === 'number');

  return {
    days: [...byDate.entries()]
      .map(([date, models]) => ({ date, models }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    models: [...totals.entries()]
      .map(([model, acc]) => ({
        model,
        ...acc,
        share: grandTotal > 0 ? acc.totalTokens / grandTotal : 0,
      }))
      .sort((a, b) => b.share - a.share),
    trackedSince: trackedSinceValues.length > 0 ? Math.min(...trackedSinceValues) : null,
    capturedAt: Math.max(...all.map(p => p.capturedAt)),
  };
}

export interface BackendRuntimeUsage {
  backendId: string;
  name: string;
  payload: RuntimeUsagePayload;
}

/**
 * Combine several backends' runtime usage into one payload.
 *
 * The SAME database reached through two connections (local + gateway) reports
 * the same datasetId and is counted ONCE (design §8) — the duplicate set is
 * returned so the UI can surface "deduplicated" instead of silently adding.
 * Numeric values merge; coverage rates recompute from merged counts; the
 * per-date/runtime series merges additively.
 */
export function aggregateRuntimeUsage(entries: BackendRuntimeUsage[]): {
  merged: RuntimeUsagePayload | null;
  deduplicated: number;
  sourcesTotal: number;
} {
  if (entries.length === 0) return { merged: null, deduplicated: 0, sourcesTotal: 0 };

  // Keep the first payload per datasetId (identical data by definition).
  const byDataset = new Map<string, BackendRuntimeUsage>();
  let deduplicated = 0;
  for (const entry of entries) {
    const key = entry.payload.datasetId;
    if (byDataset.has(key)) {
      deduplicated += 1;
      continue;
    }
    byDataset.set(key, entry);
  }
  const unique = [...byDataset.values()];
  const sourcesTotal = entries.length;
  if (unique.length === 1) {
    return { merged: unique[0].payload, deduplicated, sourcesTotal };
  }

  const all = unique.map(e => e.payload);
  const addNullable = (values: Array<number | null>): number | null => {
    const known = values.filter((v): v is number => v !== null);
    return known.length > 0 ? known.reduce((a, b) => a + b, 0) : null;
  };

  const totals = {
    recordedTokens: addNullable(all.map(p => p.totals.recordedTokens)),
    completeTokens: addNullable(all.map(p => p.totals.completeTokens)),
    partialTokens: addNullable(all.map(p => p.totals.partialTokens)),
    legacyTokens: addNullable(all.map(p => p.totals.legacyTokens)),
    activeRecordedTokens: addNullable(all.map(p => p.totals.activeRecordedTokens)),
  };

  const coverageCounts = (
    key: 'complete' | 'partial' | 'missing' | 'eligibleFinalized' | 'inFlight' | 'legacyRecordCount'
  ) => all.reduce((n, p) => n + p.coverage[key], 0);
  const eligibleFinalized = coverageCounts('eligibleFinalized');
  const complete = coverageCounts('complete');

  const runtimes = mergeRuntimeRows(all);
  const series = mergeSeries(all);

  const sinceValues = all
    .map(p => p.accountingSince)
    .filter((v): v is number => typeof v === 'number');

  return {
    merged: {
      schemaVersion: 1,
      datasetId: [...byDataset.keys()].sort().join(','),
      asOf: Math.max(...all.map(p => p.asOf)),
      timeZone: all[0].timeZone,
      accountingSince: sinceValues.length > 0 ? Math.min(...sinceValues) : null,
      accountingActive: all.some(p => p.accountingActive),
      capturedAt: Math.max(...all.map(p => p.capturedAt)),
      totals,
      coverage: {
        complete,
        partial: coverageCounts('partial'),
        missing: coverageCounts('missing'),
        eligibleFinalized,
        inFlight: coverageCounts('inFlight'),
        rate: eligibleFinalized > 0 ? complete / eligibleFinalized : null,
        legacyRecordCount: coverageCounts('legacyRecordCount'),
      },
      runtimes,
      series,
    },
    deduplicated,
    sourcesTotal,
  };
}

function mergeRuntimeRows(all: RuntimeUsagePayload[]): RuntimeUsagePayload['runtimes'] {
  interface RowAcc {
    runtimeLabel: string | null;
    recordedKnown: boolean;
    recorded: number;
    inputKnown: boolean;
    input: number;
    outputKnown: boolean;
    output: number;
    calls: number;
    completeCalls: number;
    partialCalls: number;
    missingCalls: number;
    legacyCalls: number;
    inFlightCalls: number;
    models: Map<string, number>;
  }
  const accs = new Map<string, RowAcc>();
  for (const payload of all) {
    for (const row of payload.runtimes) {
      const acc =
        accs.get(row.runtimeId) ??
        ({
          runtimeLabel: row.runtimeLabel,
          recordedKnown: false,
          recorded: 0,
          inputKnown: false,
          input: 0,
          outputKnown: false,
          output: 0,
          calls: 0,
          completeCalls: 0,
          partialCalls: 0,
          missingCalls: 0,
          legacyCalls: 0,
          inFlightCalls: 0,
          models: new Map(),
        } satisfies RowAcc);
      if (row.recordedTokens !== null) {
        acc.recordedKnown = true;
        acc.recorded += row.recordedTokens;
      }
      if (row.inputTokens !== null) {
        acc.inputKnown = true;
        acc.input += row.inputTokens;
      }
      if (row.outputTokens !== null) {
        acc.outputKnown = true;
        acc.output += row.outputTokens;
      }
      acc.calls += row.calls;
      acc.completeCalls += row.completeCalls;
      acc.partialCalls += row.partialCalls;
      acc.missingCalls += row.missingCalls;
      acc.legacyCalls += row.legacyCalls;
      acc.inFlightCalls += row.inFlightCalls;
      for (const model of row.models) {
        const key = model.modelId ?? '__unknown__';
        acc.models.set(key, (acc.models.get(key) ?? 0) + model.tokens);
      }
      accs.set(row.runtimeId, acc);
    }
  }
  return [...accs.entries()]
    .map(([runtimeId, acc]) => ({
      runtimeId,
      runtimeLabel: acc.runtimeLabel,
      recordedTokens: acc.recordedKnown ? acc.recorded : null,
      inputTokens: acc.inputKnown ? acc.input : null,
      outputTokens: acc.outputKnown ? acc.output : null,
      calls: acc.calls,
      completeCalls: acc.completeCalls,
      partialCalls: acc.partialCalls,
      missingCalls: acc.missingCalls,
      legacyCalls: acc.legacyCalls,
      inFlightCalls: acc.inFlightCalls,
      coverageRate: acc.calls > 0 ? acc.completeCalls / acc.calls : null,
      models: [...acc.models.entries()]
        .map(([modelId, tokens]) => ({
          modelId: modelId === '__unknown__' ? null : modelId,
          tokens,
        }))
        .sort((a, b) => b.tokens - a.tokens),
    }))
    .sort((a, b) => (b.recordedTokens ?? 0) - (a.recordedTokens ?? 0));
}

function mergeSeries(all: RuntimeUsagePayload[]): RuntimeUsagePayload['series'] {
  const byDate = new Map<string, Map<string, number>>();
  for (const payload of all) {
    for (const point of payload.series) {
      const runtimes = byDate.get(point.date) ?? new Map<string, number>();
      for (const [runtimeId, tokens] of Object.entries(point.runtimes)) {
        runtimes.set(runtimeId, (runtimes.get(runtimeId) ?? 0) + tokens);
      }
      byDate.set(point.date, runtimes);
    }
  }
  return [...byDate.entries()]
    .map(([date, runtimes]) => ({ date, runtimes: Object.fromEntries(runtimes) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
