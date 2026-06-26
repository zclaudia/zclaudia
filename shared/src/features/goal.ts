export type GoalStatus = 'active' | 'paused' | 'completed' | 'budget-limited' | 'aborted';

export interface Goal {
  id: string;
  sessionId: string;
  objective: string;
  status: GoalStatus;
  tokenBudget: number;
  tokensUsed: number;
  maxTurns: number;
  turnsUsed: number;
  startedAt: number;
  endedAt: number | null;
  endReason: string | null;
  lastVerdictReason: string | null;
}

export interface SetGoalInput {
  objective: string;
  tokenBudget?: number;
  maxTurns?: number;
}

export type EvaluatorVerdictKind = 'done' | 'continue' | 'blocked' | 'error';

export interface EvaluatorVerdict {
  kind: EvaluatorVerdictKind;
  reason: string;
}

export const GOAL_DEFAULTS = {
  tokenBudget: 200_000,
  maxTurns: 50,
  evaluatorTranscriptWindow: 8,
  objectiveMaxChars: 1000,
} as const;

export const GOAL_AUTO_CONTINUATION_TEXT =
  'Continue working toward the goal. Stop only when the completion condition is met.';
