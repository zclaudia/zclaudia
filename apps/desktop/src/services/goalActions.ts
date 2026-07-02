import type { Goal } from '@zclaudia/shared';
import { setGoal, clearGoal } from './api/goals';
import { useGoalStore } from '../stores/goalStore';

/**
 * Activate (or replace) a goal for a session. If the session already has an
 * active or paused goal, it is cleared first (the server lock releases only
 * after clearGoal resolves, so the sequential await is sufficient before
 * setGoal). Optional tokenBudget/maxTurns fall back to the server defaults.
 *
 * Shared by the GoalDialog submit and (soon) the /goal command so there is one path.
 */
export async function activateGoal(
  sessionId: string,
  args: { objective: string; tokenBudget?: number; maxTurns?: number }
): Promise<Goal> {
  const store = useGoalStore.getState();
  const current = store.bySession[sessionId]?.goal ?? null;
  if (current && (current.status === 'active' || current.status === 'paused')) {
    await clearGoal(sessionId);
  }
  const next = await setGoal(sessionId, args);
  store.setGoal(sessionId, next);
  return next;
}
