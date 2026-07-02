import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach } from 'vitest';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { GoalRepository } from '../repository.js';

function makeDb() {
  const db = new Database(':memory:');
  applyMigrations(db);
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

describe('GoalRepository', () => {
  let db: Database.Database;
  let repo: GoalRepository;

  beforeEach(() => {
    db = makeDb();
    repo = new GoalRepository(db);
  });

  it('creates an active goal and reads it back', () => {
    const goal = repo.create({
      sessionId: 's1',
      objective: 'tests pass',
      tokenBudget: 100_000,
      maxTurns: 20,
    });
    expect(goal.status).toBe('active');
    expect(goal.tokensUsed).toBe(0);
    const found = repo.findActive('s1');
    expect(found?.id).toBe(goal.id);
  });

  it('findActive ignores terminal goals', () => {
    const goal = repo.create({ sessionId: 's1', objective: 'x', tokenBudget: 1, maxTurns: 1 });
    repo.update(goal.id, { status: 'aborted', endedAt: Date.now(), endReason: 'cleared' });
    expect(repo.findActive('s1')).toBeNull();
  });

  it('update merges fields without losing untouched columns', () => {
    const goal = repo.create({ sessionId: 's1', objective: 'x', tokenBudget: 1000, maxTurns: 5 });
    repo.update(goal.id, { tokensUsed: 250 });
    const updated = repo.findById(goal.id);
    expect(updated?.tokensUsed).toBe(250);
    expect(updated?.tokenBudget).toBe(1000);
  });

  it('update throws when id does not exist', () => {
    expect(() => repo.update('does-not-exist', { tokensUsed: 1 })).toThrowError(/not found/i);
  });
});
