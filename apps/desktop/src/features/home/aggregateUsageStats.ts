import type {
  ModelUsagePayload,
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
  };
}

/**
 * Combine several backends' per-model usage. Days merge per date+model and
 * totals merge per model; shares are recomputed against the merged grand total
 * so the legend still sums to 100%.
 */
export function aggregateModelStats(all: ModelUsagePayload[]): ModelUsagePayload | null {
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
