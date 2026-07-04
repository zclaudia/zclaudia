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

function seedSession(id: string) {
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(id, 'p1', 1, 1);
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
    const stats = computeUsageStats(db);
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
    const stats = computeUsageStats(db);
    expect(stats.activeDays).toEqual([
      { date: localDateString(noonDaysAgo(2)), count: 2 },
      { date: localDateString(noonDaysAgo(0)), count: 1 },
    ]);
  });

  it('excludes user messages older than 182 days from activeDays', () => {
    seedSession('s1');
    seedMessage('user', noonDaysAgo(200));
    seedMessage('user', noonDaysAgo(0));
    const stats = computeUsageStats(db);
    expect(stats.activeDays).toHaveLength(1);
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
});
