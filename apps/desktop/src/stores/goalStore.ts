import { create } from 'zustand';
import type { Goal } from '@zclaudia/shared';

interface GoalSlot {
  goal: Goal | null;
  budgetTokensUsed: number;
  budgetTurnsUsed: number;
  lastVerdictReason: string | null;
}

interface GoalState {
  bySession: Record<string, GoalSlot>;
  setGoal: (sessionId: string, goal: Goal | null) => void;
  applyBudget: (sessionId: string, tokensUsed: number, turnsUsed: number) => void;
  applyVerdict: (sessionId: string, reason: string) => void;
  clearSession: (sessionId: string) => void;
}

const emptySlot: GoalSlot = {
  goal: null,
  budgetTokensUsed: 0,
  budgetTurnsUsed: 0,
  lastVerdictReason: null,
};

export const useGoalStore = create<GoalState>((set) => ({
  bySession: {},

  setGoal: (sessionId, goal) =>
    set((state) => ({
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
    set((state) => ({
      bySession: {
        ...state.bySession,
        [sessionId]: {
          ...(state.bySession[sessionId] ?? emptySlot),
          budgetTokensUsed: tokensUsed,
          budgetTurnsUsed: turnsUsed,
        },
      },
    })),

  applyVerdict: (sessionId, reason) =>
    set((state) => ({
      bySession: {
        ...state.bySession,
        [sessionId]: {
          ...(state.bySession[sessionId] ?? emptySlot),
          lastVerdictReason: reason,
        },
      },
    })),

  clearSession: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...rest } = state.bySession;
      return { bySession: rest };
    }),
}));
