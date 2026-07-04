import { beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { computeUsageStats, computeStreak, createUsageStatsRoutes } from '../usage-stats.js';

const DAY = 86_400_000;

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

/** Noon (local) N days ago — keeps every seeded row safely inside one local day. */
function noonDaysAgo(n: number): number {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.getTime() - n * DAY;
}

function localDateString(ms: number): string {
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

let db: Database.Database;
let seq = 0;

function seedSession(id: string, createdAt = 1) {
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(id, 'p1', createdAt, createdAt);
}

function seedMessage(role: string, createdAt: number, usageTokens?: number) {
  const metadata =
    usageTokens === undefined ? null : JSON.stringify({ usage: { totalTokens: usageTokens } });
  db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)').run(
    `m${seq++}`,
    's1',
    role,
    'x',
    metadata,
    createdAt
  );
}

describe('computeUsageStats', () => {
  beforeEach(() => {
    db = createTestDb();
    seq = 0;
  });

  it('counts sessions and messages and sums assistant usage tokens', () => {
    seedSession('s1');
    seedSession('s2');
    seedMessage('user', noonDaysAgo(0));
    seedMessage('assistant', noonDaysAgo(0), 1200);
    seedMessage('assistant', noonDaysAgo(1), 800);
    seedMessage('assistant', noonDaysAgo(1)); // no usage metadata — ignored in sum
    const stats = computeUsageStats(db, 'all');
    expect(stats.sessions).toBe(2);
    expect(stats.messages).toBe(4);
    expect(stats.totalTokens).toBe(2000);
  });

  it('buckets active days by user messages only, ascending', () => {
    seedSession('s1');
    seedMessage('user', noonDaysAgo(2));
    seedMessage('user', noonDaysAgo(2));
    seedMessage('user', noonDaysAgo(0));
    seedMessage('assistant', noonDaysAgo(1), 10); // assistant does not create an active day
    const stats = computeUsageStats(db, 'all');
    expect(stats.activeDays).toEqual([
      { date: localDateString(noonDaysAgo(2)), count: 2 },
      { date: localDateString(noonDaysAgo(0)), count: 1 },
    ]);
  });

  it('excludes user messages older than 182 days from activeDays', () => {
    seedSession('s1');
    seedMessage('user', noonDaysAgo(200));
    seedMessage('user', noonDaysAgo(0));
    const stats = computeUsageStats(db, 'all');
    expect(stats.activeDays).toHaveLength(1);
  });

  it('windows sessions, messages, and tokens by range', () => {
    seedSession('old', noonDaysAgo(40));
    seedSession('recent', noonDaysAgo(2));
    seedMessage('user', noonDaysAgo(40));
    seedMessage('assistant', noonDaysAgo(40), 1000);
    seedMessage('user', noonDaysAgo(10));
    seedMessage('assistant', noonDaysAgo(10), 300);
    seedMessage('user', noonDaysAgo(2));
    seedMessage('assistant', noonDaysAgo(2), 50);

    const week = computeUsageStats(db, '7d');
    expect(week.sessions).toBe(1);
    expect(week.messages).toBe(2);
    expect(week.totalTokens).toBe(50);
    expect(week.allTimeTokens).toBe(1350);

    const month = computeUsageStats(db, '30d');
    expect(month.messages).toBe(4);
    expect(month.totalTokens).toBe(350);
  });

  it('keeps activeDays full-window under a range but windows activeDaysCount', () => {
    seedSession('s1');
    seedMessage('user', noonDaysAgo(20));
    seedMessage('user', noonDaysAgo(2));
    const week = computeUsageStats(db, '7d');
    expect(week.activeDays).toHaveLength(2); // heatmap data unaffected
    expect(week.activeDaysCount).toBe(1);
  });

  it('computes the longest streak within the range', () => {
    seedSession('s1');
    for (const n of [9, 8, 7, 3, 2]) seedMessage('user', noonDaysAgo(n));
    const all = computeUsageStats(db, 'all');
    expect(all.longestStreakDays).toBe(3); // 9,8,7
    const week = computeUsageStats(db, '7d');
    expect(week.longestStreakDays).toBe(2); // 3,2 (8,9 outside window)
  });

  it('computes peak hour as the mode with earliest-hour ties, null when empty', () => {
    seedSession('s1');
    const at = (daysAgo: number, hour: number) => {
      const d = new Date();
      d.setHours(hour, 0, 0, 0);
      return d.getTime() - daysAgo * DAY;
    };
    seedMessage('user', at(1, 9));
    seedMessage('user', at(2, 9));
    seedMessage('user', at(1, 15));
    seedMessage('user', at(2, 15));
    seedMessage('user', at(3, 20));
    // 9 and 15 tie with 2 each -> earliest hour wins
    expect(computeUsageStats(db, 'all').peakHour).toBe(9);
    expect(computeUsageStats(createTestDb(), 'all').peakHour).toBeNull();
  });
});

describe('computeStreak', () => {
  const today = localDateString(noonDaysAgo(0));

  it('counts consecutive days ending today', () => {
    const days = [2, 1, 0].map(n => localDateString(noonDaysAgo(n)));
    expect(computeStreak(days, today)).toBe(3);
  });

  it('starts from yesterday when today is idle', () => {
    const days = [3, 2, 1].map(n => localDateString(noonDaysAgo(n)));
    expect(computeStreak(days, today)).toBe(3);
  });

  it('breaks on a gap and is zero when neither today nor yesterday is active', () => {
    expect(computeStreak([localDateString(noonDaysAgo(1)), localDateString(noonDaysAgo(3))], today)).toBe(1);
    expect(computeStreak([localDateString(noonDaysAgo(2))], today)).toBe(0);
    expect(computeStreak([], today)).toBe(0);
  });
});

describe('GET /usage', () => {
  beforeEach(() => {
    db = createTestDb();
    seq = 0;
  });

  function makeApp(ttlMs = 0) {
    const app = express();
    app.use('/api/stats', createUsageStatsRoutes(db, { ttlMs }));
    return app;
  }

  it('returns the aggregated payload in the success envelope', async () => {
    seedSession('s1');
    seedMessage('user', noonDaysAgo(0));
    seedMessage('assistant', noonDaysAgo(0), 500);
    const res = await request(makeApp()).get('/api/stats/usage');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sessions).toBe(1);
    expect(res.body.data.messages).toBe(2);
    expect(res.body.data.totalTokens).toBe(500);
    expect(res.body.data.currentStreakDays).toBe(1);
    expect(res.body.data.activeDaysCount).toBe(1);
    expect(res.body.data.longestStreakDays).toBe(1);
    expect(res.body.data.allTimeTokens).toBe(500);
    expect(typeof res.body.data.peakHour).toBe('number');
    expect(typeof res.body.data.capturedAt).toBe('number');
  });

  it('serves cached data within the TTL', async () => {
    seedSession('s1');
    const app = makeApp(60_000);
    const first = await request(app).get('/api/stats/usage');
    seedSession('s2'); // would change the count if not cached
    const second = await request(app).get('/api/stats/usage');
    expect(first.body.data.sessions).toBe(1);
    expect(second.body.data.sessions).toBe(1);
  });

  it('parses the range param and caches per range', async () => {
    seedSession('old', noonDaysAgo(40));
    seedSession('recent', noonDaysAgo(2));
    const app = makeApp(60_000);
    const all = await request(app).get('/api/stats/usage');
    const week = await request(app).get('/api/stats/usage?range=7d');
    expect(all.body.data.sessions).toBe(2);
    expect(week.body.data.sessions).toBe(1);
    seedSession('another', noonDaysAgo(1)); // cached: neither changes
    const all2 = await request(app).get('/api/stats/usage');
    const week2 = await request(app).get('/api/stats/usage?range=7d');
    expect(all2.body.data.sessions).toBe(2);
    expect(week2.body.data.sessions).toBe(1);
  });

  it('falls back to all for an invalid range param', async () => {
    seedSession('s1', noonDaysAgo(40));
    const res = await request(makeApp()).get('/api/stats/usage?range=99d');
    expect(res.body.data.sessions).toBe(1);
  });
});
