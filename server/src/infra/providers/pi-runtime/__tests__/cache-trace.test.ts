import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { migration as cacheTraceMigration } from '../../../storage/migrations/047_prompt_cache_trace.js';
import { CacheTraceRepository } from '../../../../domains/usage/cache-trace-repository.js';
import { piCallRows, startPiCacheTrace } from '../cache-trace.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, forked_from_session_id TEXT);
           INSERT INTO sessions (id) VALUES ('s1');`);
  db.exec(cacheTraceMigration.sql);
  return db;
}

const user = (text: string) => ({ role: 'user', content: text, timestamp: 1 }) as AgentMessage;

function assistant(at: number, usage: { input: number; cacheRead: number; cacheWrite: number }) {
  return {
    role: 'assistant',
    content: [],
    model: 'claude-sonnet-4-5',
    timestamp: at,
    stopReason: 'stop',
    usage: { ...usage, output: 50 },
  } as unknown as AgentMessage;
}

function trace(db: Database.Database, invocationId: string, history: AgentMessage[], over = {}) {
  return startPiCacheTrace({
    db,
    sessionId: 's1',
    invocationId,
    model: 'claude-sonnet-4-5',
    systemPrompt: 'You are pi.',
    tools: [],
    history,
    trimmedMessages: 0,
    ...over,
  });
}

describe('pi prompt-cache trace', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = createDb();
  });

  it('records the run fingerprint and one row per provider call', () => {
    trace(db, 'inv-1', [], { startedAt: 100 })!.finish([
      user('hi'),
      assistant(1000, { input: 10, cacheRead: 0, cacheWrite: 4000 }),
      // An error that never reached the provider is not a call.
      assistant(1500, { input: 0, cacheRead: 0, cacheWrite: 0 }),
      assistant(2000, { input: 20, cacheRead: 4010, cacheWrite: 300 }),
    ]);
    const timeline = new CacheTraceRepository(db).sessionTimeline('s1', 50);
    expect(timeline.calls.map(c => [c.callIndex, c.at, c.verdict])).toEqual([
      [0, 1000, 'cold'],
      [1, 2000, 'hit'],
    ]);
  });

  it("checks whether the previous run's history survived as this run's prefix", () => {
    const h1 = [user('a'), user('b')];
    trace(db, 'inv-1', h1, { startedAt: 1 })!.finish([]);
    trace(db, 'inv-2', [...h1, user('c')], { startedAt: 2 })!.finish([]);
    trace(db, 'inv-3', [user('summary'), user('c')], { startedAt: 3 })!.finish([]);
    const rows = db
      .prepare('SELECT history_prefix_intact AS p FROM prompt_cache_runs ORDER BY started_at')
      .all() as Array<{ p: number | null }>;
    expect(rows.map(r => r.p)).toEqual([null, 1, 0]);
  });

  it('flags a changed system prompt at the run boundary', () => {
    trace(db, 'inv-1', [], { startedAt: 1 })!.finish([
      assistant(1000, { input: 0, cacheRead: 0, cacheWrite: 5000 }),
    ]);
    trace(db, 'inv-2', [], { startedAt: 2, systemPrompt: 'You are pi. Plan mode.' })!.finish([
      assistant(2000, { input: 5000, cacheRead: 0, cacheWrite: 0 }),
    ]);
    const calls = new CacheTraceRepository(db).sessionTimeline('s1', 50).calls;
    expect(calls[1]).toMatchObject({ verdict: 'miss', causes: ['prompt_changed'] });
  });

  it('is a no-op without a database, session or trace schema', () => {
    expect(trace(db, 'inv-1', [], { db: undefined })).toBeNull();
    expect(trace(db, 'inv-1', [], { sessionId: undefined })).toBeNull();
    expect(trace(db, 'inv-1', [], { sessionId: 'playground-1' })).toBeNull();
    expect(trace(new Database(':memory:'), 'inv-1', [])).toBeNull();
  });

  it('piCallRows keeps call order and model', () => {
    expect(
      piCallRows([assistant(5, { input: 1, cacheRead: 2, cacheWrite: 3 })]).map(r => [
        r.callIndex,
        r.model,
        r.tokens,
      ])
    ).toEqual([[0, 'claude-sonnet-4-5', { inputUncached: 1, cacheRead: 2, cacheWrite: 3 }]]);
  });
});
