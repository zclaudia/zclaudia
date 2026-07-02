import { GOAL_AUTO_CONTINUATION_TEXT } from '@zclaudia/shared';
import { type GoalService } from './service.js';
import { type GoalEvaluator, type TranscriptMessage } from './evaluator.js';

export interface TranscriptPort {
  read(sessionId: string, lookback: number): Promise<TranscriptMessage[]>;
}

export interface ContinueTurnPort {
  appendAndRun(
    sessionId: string,
    text: string,
    metadata: { source: 'goal-auto'; goalId: string }
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

  async onTurnCompleted(sessionId: string, runTokensUsed = 0): Promise<void> {
    let goal = this.deps.service.getActive(sessionId);
    if (!goal || goal.status !== 'active') return;

    // Count the actual agent-turn tokens before gating so the budget reflects
    // real work (evaluator + session), not just evaluator overhead.
    if (runTokensUsed > 0) {
      try {
        goal = this.deps.service.addTokenUsage(goal.id, runTokensUsed);
      } catch (err) {
        console.warn(`[goal] run-token write skipped for ${goal.id}:`, err);
        return;
      }
    }

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

    // Service writes (token usage + verdict). If a concurrent clear/complete
    // happened between getActive() and now, requireNonTerminal will throw;
    // catch and abandon this turn — the goal already reached its terminal
    // state through another path.
    try {
      this.deps.service.addTokenUsage(goal.id, evalResult.tokensUsed);
      this.deps.service.recordVerdict(goal.id, evalResult.verdict.kind, evalResult.verdict.reason);
    } catch (err) {
      console.warn(`[goal] post-eval write skipped for ${goal.id}:`, err);
      return;
    }

    switch (evalResult.verdict.kind) {
      case 'done':
        this.deps.service.markCompleted(goal.id, evalResult.verdict.reason || 'done');
        return;
      case 'blocked':
        this.deps.service.markCompleted(
          goal.id,
          `blocked: ${evalResult.verdict.reason || 'no progress'}`
        );
        return;
      case 'error':
        return;
      case 'continue':
        break;
    }

    // Continue path: increment the turn counter, then schedule the next turn
    // via the continuer. If the continuer fails, we can't recover — the next
    // turn would never fire — so explicitly mark the goal as budget-limited
    // with a 'continuation failed' reason. This surfaces the stuck state to
    // the UI rather than letting the goal hang silently.
    this.deps.service.incrementTurns(goal.id);
    try {
      await this.deps.continuer.appendAndRun(sessionId, GOAL_AUTO_CONTINUATION_TEXT, {
        source: 'goal-auto',
        goalId: goal.id,
      });
    } catch (err) {
      console.warn(`[goal] continuation failed for ${goal.id}:`, err);
      try {
        this.deps.service.markBudgetLimited(goal.id, 'continuation failed');
      } catch (markErr) {
        console.warn(
          `[goal] markBudgetLimited after continuation failure failed for ${goal.id}:`,
          markErr
        );
      }
    }
  }

  /**
   * Called when a paused goal is resumed. Re-arms the autonomous loop by
   * kicking exactly one continuation turn (its completion re-triggers
   * onTurnCompleted → evaluate → continue). No-op unless the goal is active
   * and within budget. Mirrors the continue path of onTurnCompleted.
   */
  async onResumed(sessionId: string): Promise<void> {
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

    this.deps.service.incrementTurns(goal.id);
    try {
      await this.deps.continuer.appendAndRun(sessionId, GOAL_AUTO_CONTINUATION_TEXT, {
        source: 'goal-auto',
        goalId: goal.id,
      });
    } catch (err) {
      console.warn(`[goal] resume continuation failed for ${goal.id}:`, err);
      try {
        this.deps.service.markBudgetLimited(goal.id, 'continuation failed');
      } catch (markErr) {
        console.warn(
          `[goal] markBudgetLimited after resume failure failed for ${goal.id}:`,
          markErr
        );
      }
    }
  }
}
