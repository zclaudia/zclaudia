/**
 * Usage statistics for the Home page stats strip.
 * Read-only aggregation over sessions/messages; day bucketing uses the
 * server's local timezone.
 */

import { Router, type Request, type Response } from 'express';
import type { Database } from 'better-sqlite3';
import type { UsageStatsPayload, UsageActiveDay } from '@zclaudia/shared/core/usage-stats';

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

/** Served by the partial index `idx_messages_user_created_at` (migration 031). */
export const ACTIVE_DAYS_SQL = `SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS date, COUNT(*) AS count
       FROM messages WHERE role = 'user' AND created_at >= ?
       GROUP BY date ORDER BY date`;

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

export function computeUsageStats(db: Database): UsageStatsPayload {
  const now = Date.now();
  const sessions = (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
  const messages = (db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n;
  const totalTokens = (db.prepare(ASSISTANT_TOKENS_SUM_SQL).get() as { n: number }).n;
  const activeDays = db
    .prepare(ACTIVE_DAYS_SQL)
    .all(now - ACTIVE_DAYS_WINDOW_MS) as UsageActiveDay[];

  return {
    sessions,
    messages,
    totalTokens,
    currentStreakDays: computeStreak(
      activeDays.map(d => d.date),
      localDateString(now)
    ),
    activeDays,
    capturedAt: now,
  };
}

export function createUsageStatsRoutes(
  db: Database,
  opts: { ttlMs?: number } = {}
): Router {
  const ttlMs = opts.ttlMs ?? 60_000;
  const router = Router();
  let cache: { data: UsageStatsPayload; at: number } | null = null;

  // GET /api/stats/usage — aggregate usage stats for the Home page
  router.get('/usage', (_req: Request, res: Response) => {
    try {
      if (!cache || Date.now() - cache.at > ttlMs) {
        cache = { data: computeUsageStats(db), at: Date.now() };
      }
      res.json({ success: true, data: cache.data });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'STATS_ERROR', message: (error as Error).message },
      });
    }
  });

  return router;
}
