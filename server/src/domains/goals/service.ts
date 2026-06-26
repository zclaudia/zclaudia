import { GOAL_DEFAULTS } from '@zclaudia/shared';
import type { Goal, GoalStatus, SetGoalInput, EvaluatorVerdictKind, GoalEventPublisher } from './types.js';
import { GoalRepository } from './repository.js';

const TERMINAL_STATUSES: GoalStatus[] = ['completed', 'budget-limited', 'aborted'];

export class GoalService {
  constructor(
    private readonly repo: GoalRepository,
    private readonly events: GoalEventPublisher,
  ) {}

  get(id: string): Goal | null {
    return this.repo.findById(id);
  }

  getActive(sessionId: string): Goal | null {
    return this.repo.findActive(sessionId);
  }

  setGoal(sessionId: string, args: SetGoalInput): Goal {
    if (this.repo.findActive(sessionId)) {
      throw new Error('session already has an active goal — clear it first');
    }
    const objective = args.objective.trim();
    if (objective.length === 0) {
      throw new Error('objective must be non-empty');
    }
    if (objective.length > GOAL_DEFAULTS.objectiveMaxChars) {
      throw new Error(`objective exceeds ${GOAL_DEFAULTS.objectiveMaxChars} chars`);
    }
    const goal = this.repo.create({
      sessionId,
      objective,
      tokenBudget: args.tokenBudget ?? GOAL_DEFAULTS.tokenBudget,
      maxTurns: args.maxTurns ?? GOAL_DEFAULTS.maxTurns,
    });
    this.events.publish({ type: 'goal:state-changed', goal });
    return goal;
  }

  pause(id: string): Goal {
    const goal = this.requireNonTerminal(id);
    if (goal.status === 'paused') return goal;
    const updated = this.repo.update(id, { status: 'paused' });
    this.events.publish({ type: 'goal:state-changed', goal: updated });
    return updated;
  }

  resume(id: string): Goal {
    const goal = this.requireNonTerminal(id);
    if (goal.status === 'active') return goal;
    const updated = this.repo.update(id, { status: 'active' });
    this.events.publish({ type: 'goal:state-changed', goal: updated });
    return updated;
  }

  clear(id: string): Goal {
    const goal = this.repo.findById(id);
    if (!goal) throw new Error('goal not found');
    if (TERMINAL_STATUSES.includes(goal.status)) return goal;
    const updated = this.repo.update(id, {
      status: 'aborted',
      endedAt: Date.now(),
      endReason: 'user cleared',
    });
    this.events.publish({ type: 'goal:state-changed', goal: updated });
    return updated;
  }

  markCompleted(id: string, reason: string): Goal {
    this.requireNonTerminal(id);
    const updated = this.repo.update(id, {
      status: 'completed',
      endedAt: Date.now(),
      endReason: reason,
      lastVerdictReason: reason,
    });
    this.events.publish({ type: 'goal:state-changed', goal: updated });
    return updated;
  }

  markBudgetLimited(id: string, reason: string): Goal {
    this.requireNonTerminal(id);
    const updated = this.repo.update(id, {
      status: 'budget-limited',
      endedAt: Date.now(),
      endReason: reason,
    });
    this.events.publish({ type: 'goal:state-changed', goal: updated });
    return updated;
  }

  recordVerdict(id: string, kind: EvaluatorVerdictKind, reason: string): void {
    this.requireNonTerminal(id);
    if (kind !== 'error') {
      this.repo.update(id, { lastVerdictReason: reason });
    }
    this.events.publish({ type: 'goal:evaluator-verdict', goalId: id, kind, reason });
  }

  addTokenUsage(id: string, tokens: number): Goal {
    const goal = this.repo.findById(id);
    if (!goal) throw new Error('goal not found');
    const updated = this.repo.update(id, { tokensUsed: goal.tokensUsed + tokens });
    this.events.publish({
      type: 'goal:budget-update',
      goalId: id,
      tokensUsed: updated.tokensUsed,
      turnsUsed: updated.turnsUsed,
    });
    return updated;
  }

  incrementTurns(id: string): Goal {
    const goal = this.repo.findById(id);
    if (!goal) throw new Error('goal not found');
    const updated = this.repo.update(id, { turnsUsed: goal.turnsUsed + 1 });
    this.events.publish({
      type: 'goal:budget-update',
      goalId: id,
      tokensUsed: updated.tokensUsed,
      turnsUsed: updated.turnsUsed,
    });
    return updated;
  }

  listActive(): Goal[] {
    return this.repo.listActive();
  }

  private requireNonTerminal(id: string): Goal {
    const goal = this.repo.findById(id);
    if (!goal) throw new Error('goal not found');
    if (TERMINAL_STATUSES.includes(goal.status)) {
      throw new Error('cannot transition a goal in terminal state');
    }
    return goal;
  }
}
