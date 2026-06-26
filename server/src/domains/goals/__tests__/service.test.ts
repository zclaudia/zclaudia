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
     VALUES (?, ?, ?, ?)`,
  ).run('p1', 'p', now, now);
  db.prepare(
    `INSERT INTO llm_profiles (id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).run('lp1', 'lp', now, now);
  db.prepare(
    `INSERT INTO agent_profiles (id, name, llm_profile_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('ap1', 'ap', 'lp1', now, now);
  db.prepare(
    `INSERT INTO sessions (id, project_id, agent_profile_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
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
    svc = new GoalService(repo, { publish: (e) => emitted.push(e) });
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
});
