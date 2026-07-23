/**
 * Usage statistics for the Home page stats strip.
 * Read-only aggregation over sessions/messages; day bucketing uses the
 * server's local timezone.
 */

import { Router, type Request, type Response } from 'express';
import type { Database } from 'better-sqlite3';
import type {
  UsageStatsPayload,
  UsageActiveDay,
  UsageStatsRange,
  ModelUsagePayload,
  ModelUsageDay,
  ModelUsageTotal,
} from '@zclaudia/shared/core/usage-stats';

const DAY_MS = 86_400_000;
/** Heatmap horizon: 26 weeks. */
const ACTIVE_DAYS_WINDOW_MS = 182 * DAY_MS;

function localDateString(ms: number): string {
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Aggregation SQL, exported so migration tests can assert the query plan.
 * The SUM expression must stay textually identical to the expression index
 * `idx_messages_assistant_usage_tokens` (migration 031) — if they drift,
 * SQLite silently falls back to a full-table scan that JSON-parses every
 * assistant message's metadata blob.
 */
export const ASSISTANT_TOKENS_SUM_SQL = `SELECT COALESCE(SUM(CAST(json_extract(metadata, '$.usage.totalTokens') AS INTEGER)), 0) AS n
         FROM messages WHERE role = 'assistant' AND metadata IS NOT NULL`;

/** Windowed twin of ASSISTANT_TOKENS_SUM_SQL — expression must stay textually
 *  identical to the second column of idx_messages_assistant_tokens_by_time
 *  (migration 032) or the planner reverts to a table scan. */
export const ASSISTANT_TOKENS_SUM_WINDOWED_SQL = `SELECT COALESCE(SUM(CAST(json_extract(metadata, '$.usage.totalTokens') AS INTEGER)), 0) AS n
         FROM messages WHERE role = 'assistant' AND metadata IS NOT NULL AND created_at >= ?`;

/** Served by the partial index `idx_messages_user_created_at` (migration 031). */
export const ACTIVE_DAYS_SQL = `SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS date, COUNT(*) AS count
       FROM messages WHERE role = 'user' AND created_at >= ?
       GROUP BY date ORDER BY date`;

export const PEAK_HOUR_SQL = `SELECT CAST(strftime('%H', created_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour, COUNT(*) AS c
       FROM messages WHERE role = 'user' AND created_at >= ?
       GROUP BY hour ORDER BY c DESC, hour ASC LIMIT 1`;

/** Consecutive active days ending today; an idle today doesn't break the
 *  streak until the day ends, so counting falls back to yesterday. */
export function computeStreak(activeDayDates: string[], today: string): number {
  const days = new Set(activeDayDates);
  const todayMs = new Date(`${today}T12:00:00`).getTime();
  let cursorMs = days.has(today) ? todayMs : todayMs - DAY_MS;
  let streak = 0;
  while (days.has(localDateString(cursorMs))) {
    streak++;
    cursorMs -= DAY_MS;
  }
  return streak;
}

/** Longest consecutive run in an ascending list of 'YYYY-MM-DD' dates. */
export function computeLongestStreak(activeDayDates: string[]): number {
  let longest = 0;
  let run = 0;
  let prevMs: number | null = null;
  for (const date of activeDayDates) {
    const ms = new Date(`${date}T12:00:00`).getTime();
    run = prevMs !== null && Math.round((ms - prevMs) / DAY_MS) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prevMs = ms;
  }
  return longest;
}

const RANGE_MS: Record<Exclude<UsageStatsRange, 'all'>, number> = {
  '30d': 30 * DAY_MS,
  '7d': 7 * DAY_MS,
};

export function computeUsageStats(db: Database, range: UsageStatsRange = 'all'): UsageStatsPayload {
  const now = Date.now();
  const windowStartMs = range === 'all' ? 0 : now - RANGE_MS[range];

  const count = (sql: string, ...params: unknown[]) =>
    (db.prepare(sql).get(...params) as { n: number }).n;

  const sessions =
    range === 'all'
      ? count('SELECT COUNT(*) AS n FROM sessions')
      : count('SELECT COUNT(*) AS n FROM sessions WHERE created_at >= ?', windowStartMs);
  const messages =
    range === 'all'
      ? count('SELECT COUNT(*) AS n FROM messages')
      : count('SELECT COUNT(*) AS n FROM messages WHERE created_at >= ?', windowStartMs);
  const allTimeTokens = count(ASSISTANT_TOKENS_SUM_SQL);
  const totalTokens =
    range === 'all' ? allTimeTokens : count(ASSISTANT_TOKENS_SUM_WINDOWED_SQL, windowStartMs);

  // Heatmap data is range-independent: always the full 182-day window.
  const activeDays = db
    .prepare(ACTIVE_DAYS_SQL)
    .all(now - ACTIVE_DAYS_WINDOW_MS) as UsageActiveDay[];
  const windowedDays =
    range === 'all' ? activeDays : activeDays.filter(d => d.date >= localDateString(windowStartMs));

  const peakRow = db.prepare(PEAK_HOUR_SQL).get(windowStartMs) as
    | { hour: number; c: number }
    | undefined;
  const favoriteRow = db.prepare(FAVORITE_MODEL_SQL).get(windowStartMs) as
    | { model: string; total: number }
    | undefined;

  return {
    sessions,
    messages,
    totalTokens,
    activeDaysCount: windowedDays.length,
    currentStreakDays: computeStreak(
      activeDays.map(d => d.date),
      localDateString(now)
    ),
    longestStreakDays: computeLongestStreak(windowedDays.map(d => d.date)),
    peakHour: peakRow?.hour ?? null,
    favoriteModel: favoriteRow?.model ?? null,
    allTimeTokens,
    activeDays,
    capturedAt: now,
  };
}

/** Per-day per-model aggregation. Expressions must stay textually identical
 *  to idx_messages_model_usage (migration 034). */
export const MODEL_USAGE_SQL = `SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS date,
       json_extract(metadata, '$.model') AS model,
       COALESCE(SUM(CAST(json_extract(metadata, '$.usage.totalTokens') AS INTEGER)), 0) AS total,
       COALESCE(SUM(CAST(json_extract(metadata, '$.usage.output') AS INTEGER)), 0) AS output
FROM messages
WHERE role = 'assistant' AND json_extract(metadata, '$.model') IS NOT NULL AND created_at >= ?
GROUP BY date, model ORDER BY date`;

export const MODEL_TRACKED_SINCE_SQL = `SELECT MIN(created_at) AS t FROM messages
WHERE role = 'assistant' AND json_extract(metadata, '$.model') IS NOT NULL`;

/** Top model by window tokens (ties break to the lexicographically first id).
 *  Expressions must stay textually identical to idx_messages_model_usage. */
export const FAVORITE_MODEL_SQL = `SELECT json_extract(metadata, '$.model') AS model,
       COALESCE(SUM(CAST(json_extract(metadata, '$.usage.totalTokens') AS INTEGER)), 0) AS total
FROM messages
WHERE role = 'assistant' AND json_extract(metadata, '$.model') IS NOT NULL AND created_at >= ?
GROUP BY model ORDER BY total DESC, model ASC LIMIT 1`;

export function computeModelStats(db: Database, range: UsageStatsRange = 'all'): ModelUsagePayload {
  const now = Date.now();
  // Deliberate: 'all' is capped at the 182-day heatmap horizon for BOTH the
  // day series and the legend totals/shares — matching the Overview panel's
  // Active days / Longest streak semantics rather than the all-time token
  // cards. Revisit once model data older than 182 days exists (2027-01+).
  const windowStartMs = range === 'all' ? now - ACTIVE_DAYS_WINDOW_MS : now - RANGE_MS[range];

  const rows = db.prepare(MODEL_USAGE_SQL).all(windowStartMs) as Array<{
    date: string;
    model: string;
    total: number;
    output: number;
  }>;

  const dayMap = new Map<string, Record<string, number>>();
  const totals = new Map<string, { total: number; output: number }>();
  for (const row of rows) {
    const day = dayMap.get(row.date) ?? {};
    day[row.model] = (day[row.model] ?? 0) + row.total;
    dayMap.set(row.date, day);
    const t = totals.get(row.model) ?? { total: 0, output: 0 };
    t.total += row.total;
    t.output += row.output;
    totals.set(row.model, t);
  }

  const grandTotal = [...totals.values()].reduce((sum, t) => sum + t.total, 0);
  const days: ModelUsageDay[] = [...dayMap.entries()].map(([date, models]) => ({
    date,
    models,
  }));
  const models: ModelUsageTotal[] = [...totals.entries()]
    .map(([model, t]) => ({
      model,
      // Clamped: malformed usage rows (output > totalTokens) must not
      // produce a negative prompt-side count.
      inTokens: Math.max(0, t.total - t.output),
      outTokens: t.output,
      totalTokens: t.total,
      share: grandTotal > 0 ? t.total / grandTotal : 0,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const tracked = db.prepare(MODEL_TRACKED_SINCE_SQL).get() as { t: number | null };

  return { days, models, trackedSince: tracked.t ?? null, capturedAt: now };
}

export function createUsageStatsRoutes(db: Database, opts: { ttlMs?: number } = {}): Router {
  const ttlMs = opts.ttlMs ?? 60_000;
  const router = Router();
  const cache = new Map<UsageStatsRange, { data: UsageStatsPayload; at: number }>();
  const modelCache = new Map<UsageStatsRange, { data: ModelUsagePayload; at: number }>();

  // GET /api/stats/usage?range=all|30d|7d — aggregate usage stats for the Home page
  router.get('/usage', (req: Request, res: Response) => {
    try {
      const raw = req.query.range;
      const range: UsageStatsRange = raw === '30d' || raw === '7d' ? raw : 'all';
      const hit = cache.get(range);
      if (!hit || Date.now() - hit.at > ttlMs) {
        cache.set(range, { data: computeUsageStats(db, range), at: Date.now() });
      }
      res.json({ success: true, data: cache.get(range)!.data });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'STATS_ERROR', message: (error as Error).message },
      });
    }
  });

  // GET /api/stats/models?range=all|30d|7d — per-model usage for the Models tab
  router.get('/models', (req: Request, res: Response) => {
    try {
      const raw = req.query.range;
      const range: UsageStatsRange = raw === '30d' || raw === '7d' ? raw : 'all';
      const hit = modelCache.get(range);
      if (!hit || Date.now() - hit.at > ttlMs) {
        modelCache.set(range, { data: computeModelStats(db, range), at: Date.now() });
      }
      res.json({ success: true, data: modelCache.get(range)!.data });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'STATS_ERROR', message: (error as Error).message },
      });
    }
  });

  return router;
}
