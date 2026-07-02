import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach } from 'vitest';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { GoalRepository } from '../repository.js';
import { GoalService } from '../service.js';

function makeDb() {
  const db = new Database(':memory:');
  applyMigrations(db);
  // mirror the FK chain pattern from migration.test.ts / repository.test.ts
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects (id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?)`
  ).run('p1', 'p', now, now);
  db.prepare(
    `INSERT INTO llm_profiles (id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?)`
  ).run('lp1', 'lp', now, now);
  db.prepare(
    `INSERT INTO agent_profiles (id, name, llm_profile_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run('ap1', 'ap', 'lp1', now, now);
  db.prepare(
    `INSERT INTO sessions (id, project_id, agent_profile_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run('s1', 'p1', 'ap1', now, now);
  return db;
}

describe('GoalService', () => {
  let db: Database.Database;
  let repo: GoalRepository;
  let svc: GoalService;
  let emitted: unknown[];

  beforeEach(() => {
    db = makeDb();
    repo = new GoalRepository(db);
    emitted = [];
    svc = new GoalService(repo, { publish: e => emitted.push(e) });
  });

  it('setGoal creates an active goal and emits state-changed', () => {
    const goal = svc.setGoal('s1', { objective: 'tests pass' });
    expect(goal.status).toBe('active');
    expect(emitted).toHaveLength(1);
  });

  it('setGoal rejects when an active goal already exists', () => {
    svc.setGoal('s1', { objective: 'a' });
    expect(() => svc.setGoal('s1', { objective: 'b' })).toThrowError(/active goal/i);
  });

  it('pause then resume returns to active', () => {
    const goal = svc.setGoal('s1', { objective: 'a' });
    expect(svc.pause(goal.id).status).toBe('paused');
    expect(svc.resume(goal.id).status).toBe('active');
  });

  it('clear writes terminal aborted', () => {
    const goal = svc.setGoal('s1', { objective: 'a' });
    const cleared = svc.clear(goal.id);
    expect(cleared.status).toBe('aborted');
    expect(cleared.endReason).toBe('user cleared');
  });

  it('cannot pause a terminal goal', () => {
    const goal = svc.setGoal('s1', { objective: 'a' });
    svc.clear(goal.id);
    expect(() => svc.pause(goal.id)).toThrowError(/terminal/i);
  });

  it('markCompleted records reason and end timestamp', () => {
    const goal = svc.setGoal('s1', { objective: 'a' });
    const ended = svc.markCompleted(goal.id, 'tests pass');
    expect(ended.status).toBe('completed');
    expect(ended.endReason).toBe('tests pass');
    expect(ended.endedAt).toBeGreaterThan(0);
  });

  it('markBudgetLimited stamps the reason', () => {
    const goal = svc.setGoal('s1', { objective: 'a' });
    const ended = svc.markBudgetLimited(goal.id, 'token budget reached');
    expect(ended.status).toBe('budget-limited');
  });

  it('addTokenUsage accumulates and returns updated goal', () => {
    const goal = svc.setGoal('s1', { objective: 'a' });
    svc.addTokenUsage(goal.id, 500);
    svc.addTokenUsage(goal.id, 300);
    expect(svc.get(goal.id)?.tokensUsed).toBe(800);
  });

  it('recordVerdict updates lastVerdictReason for non-error kinds and emits event', () => {
    const goal = svc.setGoal('s1', { objective: 'a' });
    emitted.length = 0;
    svc.recordVerdict(goal.id, 'continue', 'still working');
    expect(svc.get(goal.id)?.lastVerdictReason).toBe('still working');
    expect(emitted).toEqual([
      {
        type: 'goal:evaluator-verdict',
        goalId: goal.id,
        kind: 'continue',
        reason: 'still working',
      },
    ]);
  });

  it('recordVerdict with error kind does NOT touch lastVerdictReason but still emits event', () => {
    const goal = svc.setGoal('s1', { objective: 'a' });
    svc.recordVerdict(goal.id, 'continue', 'first reason');
    emitted.length = 0;
    svc.recordVerdict(goal.id, 'error', 'upstream 502');
    expect(svc.get(goal.id)?.lastVerdictReason).toBe('first reason'); // unchanged
    expect(emitted).toEqual([
      { type: 'goal:evaluator-verdict', goalId: goal.id, kind: 'error', reason: 'upstream 502' },
    ]);
  });

  it('recordVerdict throws on terminal goal', () => {
    const goal = svc.setGoal('s1', { objective: 'a' });
    svc.clear(goal.id);
    expect(() => svc.recordVerdict(goal.id, 'continue', 'x')).toThrowError(/terminal/i);
  });

  it('markCompleted throws on already-terminal goal', () => {
    const goal = svc.setGoal('s1', { objective: 'a' });
    svc.markCompleted(goal.id, 'first done');
    expect(() => svc.markCompleted(goal.id, 'second done')).toThrowError(/terminal/i);
  });

  it('markBudgetLimited throws on already-terminal goal', () => {
    const goal = svc.setGoal('s1', { objective: 'a' });
    svc.markBudgetLimited(goal.id, 'first');
    expect(() => svc.markBudgetLimited(goal.id, 'second')).toThrowError(/terminal/i);
  });

  it('incrementTurns accumulates and persists', () => {
    const goal = svc.setGoal('s1', { objective: 'a' });
    svc.incrementTurns(goal.id);
    svc.incrementTurns(goal.id);
    expect(svc.get(goal.id)?.turnsUsed).toBe(2);
  });

  it('clear is idempotent on terminal goal', () => {
    const goal = svc.setGoal('s1', { objective: 'a' });
    const firstClear = svc.clear(goal.id);
    emitted.length = 0;
    const secondClear = svc.clear(goal.id);
    expect(secondClear.id).toBe(firstClear.id);
    expect(secondClear.endedAt).toBe(firstClear.endedAt);
    expect(emitted).toHaveLength(0); // no event emitted on idempotent path
  });
});
