/**
 * Model-driven plan mode toggling.
 *
 * The enter_plan_mode / exit_plan_mode tools call these to actually enforce
 * read-only execution: setting plan_status='planning' makes the next run
 * read-only (run-provider-setup keys plan mode off plan_status==='planning'),
 * and clearing it lets execution resume. Transitions are validated against the
 * shared plan-status state machine so the tools can't force a supervision-owned
 * session (planned/executing) into planning.
 */
import type { SessionRepository } from './repository.js';
import { assertPlanStatusTransition } from './plan-status-machine.js';

export interface PlanModeToggleResult {
  ok: boolean;
  /** enter: already in planning. */
  alreadyActive?: boolean;
  /** exit: was in planning before this call. */
  wasActive?: boolean;
  error?: string;
}

export function enterPlanMode(repo: SessionRepository, sessionId: string): PlanModeToggleResult {
  const session = repo.findById(sessionId);
  if (!session) return { ok: false, error: 'session_not_found' };
  if (session.planStatus === 'planning') return { ok: true, alreadyActive: true };
  try {
    assertPlanStatusTransition(session.planStatus ?? null, 'planning');
  } catch {
    return { ok: false, error: 'invalid_transition' };
  }
  repo.update(sessionId, { planStatus: 'planning' });
  return { ok: true, alreadyActive: false };
}

export function exitPlanMode(repo: SessionRepository, sessionId: string): PlanModeToggleResult {
  const session = repo.findById(sessionId);
  if (!session) return { ok: false, error: 'session_not_found' };
  if (session.planStatus !== 'planning') return { ok: true, wasActive: false };
  try {
    assertPlanStatusTransition('planning', null);
  } catch {
    return { ok: false, error: 'invalid_transition' };
  }
  repo.update(sessionId, { planStatus: null });
  return { ok: true, wasActive: true };
}
