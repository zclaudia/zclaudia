import { describe, it, expect, vi } from 'vitest';
import { GoalCoordinator } from '../coordinator.js';
import type { Goal } from '../types.js';

function makeGoal(over: Partial<Goal> = {}): Goal {
  return {
    id: 'g1', sessionId: 's1', objective: 'do it', status: 'active',
    tokenBudget: 100, tokensUsed: 0, maxTurns: 50, turnsUsed: 0,
    startedAt: 1, endedAt: null, endReason: null, lastVerdictReason: null,
    ...over,
  } as Goal;
}

function makeDeps(goal: Goal) {
  const service = {
    getActive: vi.fn(() => goal),
    addTokenUsage: vi.fn((_id: string, t: number) => { goal.tokensUsed += t; return goal; }),
    markBudgetLimited: vi.fn(),
    recordVerdict: vi.fn(),
    incrementTurns: vi.fn(),
    markCompleted: vi.fn(),
  };
  const evaluator = { evaluate: vi.fn(async () => ({ tokensUsed: 5, verdict: { kind: 'continue', reason: 'keep going' } })) };
  const transcript = { read: vi.fn(async () => []) };
  const continuer = { appendAndRun: vi.fn(async () => {}) };
  return { service, evaluator, transcript, continuer, resolveLlmProfile: () => 'p' };
}

describe('GoalCoordinator onResumed', () => {
  it('schedules one continuation turn for an active goal within budget', async () => {
    const goal = makeGoal({ status: 'active', tokenBudget: 1000, tokensUsed: 0, maxTurns: 50, turnsUsed: 3 });
    const deps = makeDeps(goal);
    const coord = new GoalCoordinator(deps as any);

    await coord.onResumed('s1');

    expect(deps.service.incrementTurns).toHaveBeenCalledWith('g1');
    expect(deps.continuer.appendAndRun).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the goal is over budget', async () => {
    const goal = makeGoal({ status: 'active', tokenBudget: 100, tokensUsed: 100 });
    const deps = makeDeps(goal);
    const coord = new GoalCoordinator(deps as any);

    await coord.onResumed('s1');

    expect(deps.continuer.appendAndRun).not.toHaveBeenCalled();
    expect(deps.service.markBudgetLimited).toHaveBeenCalledWith('g1', 'token budget reached');
  });

  it('does nothing when max turns is reached', async () => {
    const goal = makeGoal({ status: 'active', tokenBudget: 1000, tokensUsed: 0, maxTurns: 50, turnsUsed: 50 });
    const deps = makeDeps(goal);
    const coord = new GoalCoordinator(deps as any);

    await coord.onResumed('s1');

    expect(deps.continuer.appendAndRun).not.toHaveBeenCalled();
    expect(deps.service.markBudgetLimited).toHaveBeenCalledWith('g1', 'max turns reached');
  });
});

describe('GoalCoordinator token accounting', () => {
  it('adds the run tokens before the budget gate and budget-limits when exceeded', async () => {
    const goal = makeGoal({ tokenBudget: 100, tokensUsed: 0 });
    const deps = makeDeps(goal);
    const coord = new GoalCoordinator(deps as any);

    await coord.onTurnCompleted('s1', 150); // run alone exceeds the 100 budget

    expect(deps.service.addTokenUsage).toHaveBeenCalledWith('g1', 150);
    expect(deps.service.markBudgetLimited).toHaveBeenCalledWith('g1', 'token budget reached');
    expect(deps.evaluator.evaluate).not.toHaveBeenCalled();
  });

  it('counts run tokens then evaluates when within budget', async () => {
    const goal = makeGoal({ tokenBudget: 1_000, tokensUsed: 0 });
    const deps = makeDeps(goal);
    const coord = new GoalCoordinator(deps as any);

    await coord.onTurnCompleted('s1', 40);

    expect(deps.service.addTokenUsage).toHaveBeenNthCalledWith(1, 'g1', 40); // run tokens
    expect(deps.evaluator.evaluate).toHaveBeenCalled();
    expect(deps.service.addTokenUsage).toHaveBeenNthCalledWith(2, 'g1', 5); // evaluator tokens
    expect(deps.service.markBudgetLimited).not.toHaveBeenCalled();
    expect(deps.continuer.appendAndRun).toHaveBeenCalled();
  });
});
