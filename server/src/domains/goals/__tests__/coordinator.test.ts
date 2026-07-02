import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { GoalRepository } from '../repository.js';
import { GoalService } from '../service.js';
import { GoalCoordinator, type ContinueTurnPort, type TranscriptPort } from '../coordinator.js';
import { GoalEvaluator, type EvaluatorLlmPort } from '../evaluator.js';

function makeDb() {
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
     VALUES (?, 'p1', 'ap1', ?, ?)`
  ).run('s1', Date.now(), Date.now());
  return db;
}

interface Harness {
  svc: GoalService;
  coord: GoalCoordinator;
  continueCalls: Array<{ sessionId: string; text: string; metadata: unknown }>;
}

function makeHarness(verdict: 'done' | 'continue' | 'blocked'): Harness {
  const db = makeDb();
  const repo = new GoalRepository(db);
  const events: unknown[] = [];
  const svc = new GoalService(repo, { publish: e => events.push(e) });
  const llm: EvaluatorLlmPort = {
    async evaluate() {
      return { kind: verdict, reason: `${verdict}-reason`, inputTokens: 50, outputTokens: 10 };
    },
  };
  const transcript: TranscriptPort = { read: async () => [] };
  const continueCalls: Harness['continueCalls'] = [];
  const continuer: ContinueTurnPort = {
    async appendAndRun(sessionId, text, metadata) {
      continueCalls.push({ sessionId, text, metadata });
    },
  };
  const coord = new GoalCoordinator({
    service: svc,
    evaluator: new GoalEvaluator(llm),
    transcript,
    continuer,
    resolveLlmProfile: () => 'lp1',
  });
  return { svc, coord, continueCalls };
}

describe('GoalCoordinator', () => {
  it('marks completed when evaluator returns done', async () => {
    const h = makeHarness('done');
    h.svc.setGoal('s1', { objective: 'x' });
    await h.coord.onTurnCompleted('s1');
    expect(h.svc.getActive('s1')).toBeNull();
    expect(h.svc.listActive()).toHaveLength(0);
  });

  it('appends continue-turn message when verdict is continue', async () => {
    const h = makeHarness('continue');
    const goal = h.svc.setGoal('s1', { objective: 'x' });
    await h.coord.onTurnCompleted('s1');
    expect(h.continueCalls).toHaveLength(1);
    expect(h.continueCalls[0].text).toContain('Continue working');
    expect(h.continueCalls[0].metadata).toMatchObject({ source: 'goal-auto', goalId: goal.id });
    expect(h.svc.get(goal.id)?.turnsUsed).toBe(1);
  });

  it('stops with budget-limited when token budget reached pre-flight', async () => {
    const h = makeHarness('continue');
    const goal = h.svc.setGoal('s1', { objective: 'x', tokenBudget: 10 });
    h.svc.addTokenUsage(goal.id, 11);
    await h.coord.onTurnCompleted('s1');
    expect(h.svc.get(goal.id)?.status).toBe('budget-limited');
    expect(h.continueCalls).toHaveLength(0);
  });

  it('stops with budget-limited when max turns reached pre-flight', async () => {
    const h = makeHarness('continue');
    const goal = h.svc.setGoal('s1', { objective: 'x', maxTurns: 1 });
    h.svc.incrementTurns(goal.id);
    await h.coord.onTurnCompleted('s1');
    expect(h.svc.get(goal.id)?.status).toBe('budget-limited');
    expect(h.continueCalls).toHaveLength(0);
  });

  it('no-ops when goal is paused', async () => {
    const h = makeHarness('continue');
    const goal = h.svc.setGoal('s1', { objective: 'x' });
    h.svc.pause(goal.id);
    await h.coord.onTurnCompleted('s1');
    expect(h.continueCalls).toHaveLength(0);
    expect(h.svc.get(goal.id)?.status).toBe('paused');
  });

  it('treats blocked verdict as completed (terminal)', async () => {
    const h = makeHarness('blocked');
    const goal = h.svc.setGoal('s1', { objective: 'x' });
    await h.coord.onTurnCompleted('s1');
    expect(h.svc.get(goal.id)?.status).toBe('completed');
    expect(h.svc.get(goal.id)?.endReason).toContain('blocked-reason');
  });

  it('no-ops on error verdict — goal stays active, continuer not called', async () => {
    const db = makeDb();
    const repo = new GoalRepository(db);
    const events: unknown[] = [];
    const svc = new GoalService(repo, { publish: e => events.push(e) });
    const llm: EvaluatorLlmPort = {
      async evaluate() {
        throw new Error('llm down');
      },
    };
    const continueCalls: Array<unknown> = [];
    const coord = new GoalCoordinator({
      service: svc,
      evaluator: new GoalEvaluator(llm),
      transcript: { read: async () => [] },
      continuer: {
        appendAndRun: async (sid, text, meta) => {
          continueCalls.push({ sid, text, meta });
        },
      },
      resolveLlmProfile: () => 'lp1',
    });
    const goal = svc.setGoal('s1', { objective: 'x' });
    await coord.onTurnCompleted('s1');
    expect(svc.get(goal.id)?.status).toBe('active');
    expect(continueCalls).toHaveLength(0);
    expect(events.some((e: any) => e.type === 'goal:evaluator-verdict' && e.kind === 'error')).toBe(
      true
    );
  });

  it('marks goal budget-limited when continuer.appendAndRun throws', async () => {
    const db = makeDb();
    const repo = new GoalRepository(db);
    const events: unknown[] = [];
    const svc = new GoalService(repo, { publish: e => events.push(e) });
    const llm: EvaluatorLlmPort = {
      async evaluate() {
        return { kind: 'continue', reason: 'wip', inputTokens: 10, outputTokens: 5 };
      },
    };
    const coord = new GoalCoordinator({
      service: svc,
      evaluator: new GoalEvaluator(llm),
      transcript: { read: async () => [] },
      continuer: {
        appendAndRun: async () => {
          throw new Error('runtime not ready');
        },
      },
      resolveLlmProfile: () => 'lp1',
    });
    const goal = svc.setGoal('s1', { objective: 'x' });
    await coord.onTurnCompleted('s1');
    const after = svc.get(goal.id);
    expect(after?.status).toBe('budget-limited');
    expect(after?.endReason).toBe('continuation failed');
  });

  it('no-ops on concurrent terminal transition (race in recordVerdict)', async () => {
    const db = makeDb();
    const repo = new GoalRepository(db);
    const svc = new GoalService(repo, { publish: () => {} });
    let evalCallCount = 0;
    const llm: EvaluatorLlmPort = {
      async evaluate() {
        evalCallCount += 1;
        return { kind: 'continue', reason: 'wip', inputTokens: 10, outputTokens: 5 };
      },
    };
    let goalForClose: string | null = null;
    const coord = new GoalCoordinator({
      service: svc,
      evaluator: new GoalEvaluator(llm),
      transcript: {
        read: async () => {
          // Simulate a concurrent user-clear that fires between transcript read and post-eval writes.
          if (goalForClose) svc.clear(goalForClose);
          return [];
        },
      },
      continuer: {
        appendAndRun: async () => {
          throw new Error('should not reach');
        },
      },
      resolveLlmProfile: () => 'lp1',
    });
    const goal = svc.setGoal('s1', { objective: 'x' });
    goalForClose = goal.id;
    await expect(coord.onTurnCompleted('s1')).resolves.toBeUndefined();
    expect(svc.get(goal.id)?.status).toBe('aborted');
    expect(evalCallCount).toBe(1);
  });
});
