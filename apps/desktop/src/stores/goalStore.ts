import { create } from 'zustand';
import type { Goal, EvaluatorVerdictKind } from '@zclaudia/shared';

interface GoalSlot {
  goal: Goal | null;
  budgetTokensUsed: number;
  budgetTurnsUsed: number;
  lastVerdictKind: EvaluatorVerdictKind | null;
  lastVerdictReason: string | null;
}

interface GoalState {
  bySession: Record<string, GoalSlot>;
  setGoal: (sessionId: string, goal: Goal | null) => void;
  applyBudget: (sessionId: string, tokensUsed: number, turnsUsed: number) => void;
  applyVerdict: (sessionId: string, kind: EvaluatorVerdictKind, reason: string) => void;
  clearSession: (sessionId: string) => void;
}

const emptySlot: GoalSlot = {
  goal: null,
  budgetTokensUsed: 0,
  budgetTurnsUsed: 0,
  lastVerdictKind: null,
  lastVerdictReason: null,
};

export const useGoalStore = create<GoalState>(set => ({
  bySession: {},

  setGoal: (sessionId, goal) =>
    set(state => ({
      bySession: {
        ...state.bySession,
        [sessionId]: {
          ...(state.bySession[sessionId] ?? emptySlot),
          goal,
          budgetTokensUsed: goal?.tokensUsed ?? 0,
          budgetTurnsUsed: goal?.turnsUsed ?? 0,
          lastVerdictReason: goal?.lastVerdictReason ?? null,
        },
      },
    })),

  applyBudget: (sessionId, tokensUsed, turnsUsed) =>
    set(state => ({
      bySession: {
        ...state.bySession,
        [sessionId]: {
          ...(state.bySession[sessionId] ?? emptySlot),
          budgetTokensUsed: tokensUsed,
          budgetTurnsUsed: turnsUsed,
        },
      },
    })),

  applyVerdict: (sessionId, kind, reason) =>
    set(state => ({
      bySession: {
        ...state.bySession,
        [sessionId]: {
          ...(state.bySession[sessionId] ?? emptySlot),
          lastVerdictKind: kind,
          lastVerdictReason: reason,
        },
      },
    })),

  clearSession: sessionId =>
    set(state => {
      const { [sessionId]: _, ...rest } = state.bySession;
      return { bySession: rest };
    }),
}));
