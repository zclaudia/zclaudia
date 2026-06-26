import { GOAL_AUTO_CONTINUATION_TEXT } from '@zclaudia/shared';
import { GoalService } from './service.js';
import { GoalEvaluator, type TranscriptMessage } from './evaluator.js';

export interface TranscriptPort {
  read(sessionId: string, lookback: number): Promise<TranscriptMessage[]>;
}

export interface ContinueTurnPort {
  appendAndRun(
    sessionId: string,
    text: string,
    metadata: { source: 'goal-auto'; goalId: string },
  ): Promise<void>;
}

export interface GoalCoordinatorDeps {
  service: GoalService;
  evaluator: GoalEvaluator;
  transcript: TranscriptPort;
  continuer: ContinueTurnPort;
  resolveLlmProfile(sessionId: string): string;
}

export class GoalCoordinator {
  constructor(private readonly deps: GoalCoordinatorDeps) {}

  async onTurnCompleted(sessionId: string): Promise<void> {
    const goal = this.deps.service.getActive(sessionId);
    if (!goal || goal.status !== 'active') return;

    if (goal.tokensUsed >= goal.tokenBudget) {
      this.deps.service.markBudgetLimited(goal.id, 'token budget reached');
      return;
    }
    if (goal.turnsUsed >= goal.maxTurns) {
      this.deps.service.markBudgetLimited(goal.id, 'max turns reached');
      return;
    }

    const transcript = await this.deps.transcript.read(sessionId, 32);
    const evalResult = await this.deps.evaluator.evaluate({
      objective: goal.objective,
      transcript,
      llmProfileId: this.deps.resolveLlmProfile(sessionId),
    });

    this.deps.service.addTokenUsage(goal.id, evalResult.tokensUsed);
    this.deps.service.recordVerdict(goal.id, evalResult.verdict.kind, evalResult.verdict.reason);

    switch (evalResult.verdict.kind) {
      case 'done':
        this.deps.service.markCompleted(goal.id, evalResult.verdict.reason || 'done');
        return;
      case 'blocked':
        this.deps.service.markCompleted(
          goal.id,
          `blocked: ${evalResult.verdict.reason || 'no progress'}`,
        );
        return;
      case 'error':
        return;
      case 'continue':
        break;
    }

    this.deps.service.incrementTurns(goal.id);
    await this.deps.continuer.appendAndRun(sessionId, GOAL_AUTO_CONTINUATION_TEXT, {
      source: 'goal-auto',
      goalId: goal.id,
    });
  }
}
