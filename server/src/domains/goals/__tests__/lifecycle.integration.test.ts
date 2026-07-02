import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { GoalRepository } from '../repository.js';
import { GoalService } from '../service.js';
import { GoalEvaluator } from '../evaluator.js';
import { GoalCoordinator } from '../coordinator.js';

describe('Goal lifecycle (integration)', () => {
  it('runs evaluator → continue → continue → done within budget', async () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    db.prepare(
      `INSERT INTO projects (id, name, root_path, created_at, updated_at)
                VALUES ('p1', 'p', '/tmp/p', ?, ?)`
    ).run(Date.now(), Date.now());
    db.prepare(
      `INSERT INTO llm_profiles (id, name, created_at, updated_at)
                VALUES ('lp1', 'lp', ?, ?)`
    ).run(Date.now(), Date.now());
    db.prepare(
      `INSERT INTO agent_profiles (id, name, llm_profile_id, created_at, updated_at)
                VALUES ('ap1', 'ap', 'lp1', ?, ?)`
    ).run(Date.now(), Date.now());
    db.prepare(
      `INSERT INTO sessions (id, project_id, agent_profile_id, created_at, updated_at)
       VALUES ('s1', 'p1', 'ap1', ?, ?)`
    ).run(Date.now(), Date.now());

    const events: any[] = [];
    const repo = new GoalRepository(db);
    const svc = new GoalService(repo, { publish: e => events.push(e) });

    let call = 0;
    const evaluator = new GoalEvaluator({
      async evaluate() {
        call += 1;
        return call < 3
          ? { kind: 'continue', reason: 'wip', inputTokens: 10, outputTokens: 5 }
          : { kind: 'done', reason: 'tests green', inputTokens: 10, outputTokens: 5 };
      },
    });

    const continues: string[] = [];
    const coord = new GoalCoordinator({
      service: svc,
      evaluator,
      transcript: { read: async () => [] },
      continuer: {
        appendAndRun: async (sid, text) => {
          continues.push(text);
        },
      },
      resolveLlmProfile: () => 'lp1',
    });

    svc.setGoal('s1', { objective: 'tests pass', tokenBudget: 1_000_000, maxTurns: 10 });
    await coord.onTurnCompleted('s1');
    await coord.onTurnCompleted('s1');
    await coord.onTurnCompleted('s1');

    expect(continues).toHaveLength(2);
    expect(svc.listActive()).toHaveLength(0);
    expect(events.some(e => e.type === 'goal:state-changed' && e.goal.status === 'completed')).toBe(
      true
    );
  });
});
