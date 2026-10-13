import type Database from 'better-sqlite3';
import type { PlanModePort } from '../../../infra/providers/pi-runtime/plan-mode-port.js';
import { enterPlanMode, exitPlanMode } from '../../../domains/sessions/plan-mode-toggle.js';
import { SessionRepository } from '../../../domains/sessions/repository.js';
import { interactionDispatcher } from '../interactions/interaction-dispatcher.js';

export function createPlanModePort(db: Database.Database): PlanModePort {
  const repo = new SessionRepository(db);
  return {
    enter: sessionId => enterPlanMode(repo, sessionId),
    exit: sessionId => exitPlanMode(repo, sessionId),
    isPlanning: sessionId => repo.findById(sessionId)?.planStatus === 'planning',
    review: event => {
      interactionDispatcher.supersede(event.sessionId, 'interaction_plan_review');
      // Human approval has no deadline; session shutdown cancels pending reviews.
      return interactionDispatcher.dispatchAndWait(
        event.interactionId,
        event.sessionId,
        event,
        null
      );
    },
  };
}
