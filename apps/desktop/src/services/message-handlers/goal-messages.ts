import type { ServerMessage } from '@zclaudia/shared';
import { useGoalStore } from '../../stores/goalStore';

export function handleGoalMessage(msg: ServerMessage): boolean {
  switch (msg.type) {
    case 'goal:state-changed': {
      useGoalStore.getState().setGoal(msg.sessionId, msg.goal);
      return true;
    }
    case 'goal:evaluator-verdict': {
      useGoalStore.getState().applyVerdict(msg.sessionId, msg.kind, msg.reason);
      return true;
    }
    case 'goal:budget-update': {
      useGoalStore.getState().applyBudget(msg.sessionId, msg.tokensUsed, msg.turnsUsed);
      return true;
    }
    default:
      return false;
  }
}
