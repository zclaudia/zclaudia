import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { GoalRepository } from '../repository.js';
import { GoalService } from '../service.js';
import { recoverActiveGoals } from '../recovery.js';

function makeDb() {
  const db = new Database(':memory:');
  applyMigrations(db);
  db.prepare(`INSERT INTO projects (id, name, root_path, created_at, updated_at)
              VALUES ('p1', 'p', '/tmp/p', ?, ?)`).run(Date.now(), Date.now());
  db.prepare(`INSERT INTO llm_profiles (id, name, created_at, updated_at)
              VALUES ('lp1', 'lp', ?, ?)`).run(Date.now(), Date.now());
  db.prepare(`INSERT INTO agent_profiles (id, name, llm_profile_id, created_at, updated_at)
              VALUES ('ap1', 'ap', 'lp1', ?, ?)`).run(Date.now(), Date.now());
  db.prepare(`INSERT INTO sessions (id, project_id, agent_profile_id, created_at, updated_at)
              VALUES ('s1', 'p1', 'ap1', ?, ?), ('s2', 'p1', 'ap1', ?, ?)`)
    .run(Date.now(), Date.now(), Date.now(), Date.now());
  return db;
}

describe('recoverActiveGoals', () => {
  it('schedules onTurnCompleted for every active goal', async () => {
    const db = makeDb();
    const repo = new GoalRepository(db);
    const svc = new GoalService(repo, { publish: () => {} });
    svc.setGoal('s1', { objective: 'a' });
    svc.setGoal('s2', { objective: 'b' });

    const seen: string[] = [];
    const coord = { onTurnCompleted: async (sid: string) => { seen.push(sid); } };

    await recoverActiveGoals(svc, coord);
    expect(seen.sort()).toEqual(['s1', 's2']);
  });

  it('skips paused goals on recovery', async () => {
    const db = makeDb();
    const repo = new GoalRepository(db);
    const svc = new GoalService(repo, { publish: () => {} });
    const goal = svc.setGoal('s1', { objective: 'a' });
    svc.pause(goal.id);

    const seen: string[] = [];
    await recoverActiveGoals(svc, { onTurnCompleted: async (sid) => { seen.push(sid); } });
    expect(seen).toEqual([]);
  });
});
