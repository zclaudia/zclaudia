import type { Goal, GoalStatus } from '@zclaudia/shared';

export type { Goal, GoalStatus };

export interface CreateGoalInput {
  sessionId: string;
  objective: string;
  tokenBudget: number;
  maxTurns: number;
}

export interface UpdateGoalInput {
  status?: GoalStatus;
  objective?: string;
  tokenBudget?: number;
  tokensUsed?: number;
  maxTurns?: number;
  turnsUsed?: number;
  endedAt?: number;
  endReason?: string;
  lastVerdictReason?: string;
}
