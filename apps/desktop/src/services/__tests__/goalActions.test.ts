import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GOAL_DEFAULTS } from '@zclaudia/shared';
import type { Goal } from '@zclaudia/shared';

vi.mock('../api/goals', () => ({
  setGoal: vi.fn(),
  clearGoal: vi.fn(),
}));

import { setGoal, clearGoal } from '../api/goals';
import { activateGoal } from '../goalActions';
import { useGoalStore } from '../../stores/goalStore';

function makeGoal(over: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    sessionId: 's1',
    objective: 'do it',
    status: 'active',
    tokenBudget: GOAL_DEFAULTS.tokenBudget,
    tokensUsed: 0,
    maxTurns: GOAL_DEFAULTS.maxTurns,
    turnsUsed: 0,
    startedAt: 1,
    endedAt: null,
    endReason: null,
    lastVerdictReason: null,
    ...over,
  };
}

describe('activateGoal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGoalStore.setState({ bySession: {} });
  });

  it('sets a new goal and stores it', async () => {
    const created = makeGoal();
    vi.mocked(setGoal).mockResolvedValue(created);

    await activateGoal('s1', { objective: 'do it' });

    expect(clearGoal).not.toHaveBeenCalled();
    expect(setGoal).toHaveBeenCalledWith('s1', { objective: 'do it' });
    expect(useGoalStore.getState().bySession['s1'].goal).toEqual(created);
  });

  it('clears an existing active goal before setting a new one', async () => {
    useGoalStore.setState({
      bySession: {
        s1: {
          goal: makeGoal({ id: 'old' }),
          budgetTokensUsed: 0,
          budgetTurnsUsed: 0,
          lastVerdictKind: null,
          lastVerdictReason: null,
        },
      },
    });
    // activateGoal ignores clearGoal's return value; undefined keeps the intent honest.
    vi.mocked(clearGoal).mockResolvedValue(undefined as never);
    vi.mocked(setGoal).mockResolvedValue(makeGoal({ id: 'new' }));

    await activateGoal('s1', { objective: 'new one' });

    expect(clearGoal).toHaveBeenCalledWith('s1');
    expect(setGoal).toHaveBeenCalledWith('s1', { objective: 'new one' });
    // The sequential lock invariant: clearGoal must resolve before setGoal fires.
    expect(vi.mocked(clearGoal).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(setGoal).mock.invocationCallOrder[0]
    );
    expect(useGoalStore.getState().bySession['s1'].goal?.id).toBe('new');
  });

  it('clears an existing paused goal before setting a new one', async () => {
    useGoalStore.setState({
      bySession: {
        s1: {
          goal: makeGoal({ id: 'old', status: 'paused' }),
          budgetTokensUsed: 0,
          budgetTurnsUsed: 0,
          lastVerdictKind: null,
          lastVerdictReason: null,
        },
      },
    });
    vi.mocked(clearGoal).mockResolvedValue(undefined as never);
    vi.mocked(setGoal).mockResolvedValue(makeGoal({ id: 'new' }));

    await activateGoal('s1', { objective: 'new one' });

    expect(clearGoal).toHaveBeenCalledWith('s1');
    expect(setGoal).toHaveBeenCalledWith('s1', { objective: 'new one' });
    expect(useGoalStore.getState().bySession['s1'].goal?.id).toBe('new');
  });

  it('does not clear a terminal existing goal before setting a new one', async () => {
    useGoalStore.setState({
      bySession: {
        s1: {
          goal: makeGoal({ id: 'old', status: 'completed' }),
          budgetTokensUsed: 0,
          budgetTurnsUsed: 0,
          lastVerdictKind: null,
          lastVerdictReason: null,
        },
      },
    });
    vi.mocked(setGoal).mockResolvedValue(makeGoal({ id: 'new' }));

    await activateGoal('s1', { objective: 'new one' });

    expect(clearGoal).not.toHaveBeenCalled();
    expect(setGoal).toHaveBeenCalledWith('s1', { objective: 'new one' });
    expect(useGoalStore.getState().bySession['s1'].goal?.id).toBe('new');
  });
});
