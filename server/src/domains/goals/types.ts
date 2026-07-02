import type { Goal, GoalStatus, SetGoalInput, EvaluatorVerdictKind } from '@zclaudia/shared';

export type { Goal, GoalStatus, SetGoalInput, EvaluatorVerdictKind };

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

// Event publisher port — implemented by infra layer, consumed by service + coordinator
export interface GoalEventPublisher {
  publish(
    event:
      | { type: 'goal:state-changed'; goal: Goal }
      | {
          type: 'goal:evaluator-verdict';
          goalId: string;
          kind: EvaluatorVerdictKind;
          reason: string;
        }
      | { type: 'goal:budget-update'; goalId: string; tokensUsed: number; turnsUsed: number }
  ): void;
}
