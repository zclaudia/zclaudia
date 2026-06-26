import { describe, it, expect, beforeEach } from 'vitest';
import { useGoalStore } from '../goalStore';
import type { Goal } from '@zclaudia/shared';

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    sessionId: 's1',
    objective: 'tests pass',
    status: 'active',
    tokenBudget: 100000,
    tokensUsed: 250,
    maxTurns: 50,
    turnsUsed: 3,
    startedAt: 1000,
    endedAt: null,
    endReason: null,
    lastVerdictReason: null,
    ...overrides,
  };
}

beforeEach(() => {
  useGoalStore.setState({ bySession: {} });
});

describe('useGoalStore', () => {
  it('setGoal populates slot from goal', () => {
    useGoalStore.getState().setGoal('s1', makeGoal());
    const slot = useGoalStore.getState().bySession['s1'];
    expect(slot.goal?.id).toBe('g1');
    expect(slot.budgetTokensUsed).toBe(250);
    expect(slot.budgetTurnsUsed).toBe(3);
  });

  it('setGoal(null) clears the goal but keeps the slot', () => {
    useGoalStore.getState().setGoal('s1', makeGoal());
    useGoalStore.getState().setGoal('s1', null);
    const slot = useGoalStore.getState().bySession['s1'];
    expect(slot).toBeDefined();
    expect(slot.goal).toBeNull();
  });

  it('applyBudget updates only budget fields', () => {
    useGoalStore.getState().setGoal('s1', makeGoal());
    useGoalStore.getState().applyBudget('s1', 800, 5);
    const slot = useGoalStore.getState().bySession['s1'];
    expect(slot.budgetTokensUsed).toBe(800);
    expect(slot.budgetTurnsUsed).toBe(5);
    expect(slot.goal?.id).toBe('g1');
  });

  it('applyVerdict records kind and reason', () => {
    useGoalStore.getState().setGoal('s1', makeGoal());
    useGoalStore.getState().applyVerdict('s1', 'continue', 'still going');
    const slot = useGoalStore.getState().bySession['s1'];
    expect(slot.lastVerdictKind).toBe('continue');
    expect(slot.lastVerdictReason).toBe('still going');
  });

  it('clearSession removes the slot', () => {
    useGoalStore.getState().setGoal('s1', makeGoal());
    useGoalStore.getState().clearSession('s1');
    expect(useGoalStore.getState().bySession['s1']).toBeUndefined();
  });

  it('applyBudget on unknown session creates a slot', () => {
    useGoalStore.getState().applyBudget('s2', 100, 1);
    const slot = useGoalStore.getState().bySession['s2'];
    expect(slot).toBeDefined();
    expect(slot.goal).toBeNull();
    expect(slot.budgetTokensUsed).toBe(100);
  });
});
