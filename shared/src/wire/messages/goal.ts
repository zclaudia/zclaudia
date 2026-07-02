import type { Goal } from '../../features/goal.js';

export interface GoalStateChangedMessage {
  type: 'goal:state-changed';
  sessionId: string;
  goal: Goal;
}

export interface GoalEvaluatorVerdictMessage {
  type: 'goal:evaluator-verdict';
  sessionId: string;
  goalId: string;
  kind: 'done' | 'continue' | 'blocked' | 'error';
  reason: string;
}

export interface GoalBudgetUpdateMessage {
  type: 'goal:budget-update';
  sessionId: string;
  goalId: string;
  tokensUsed: number;
  turnsUsed: number;
}

export type GoalClientMessage = never;

export type GoalServerMessage =
  | GoalStateChangedMessage
  | GoalEvaluatorVerdictMessage
  | GoalBudgetUpdateMessage;
