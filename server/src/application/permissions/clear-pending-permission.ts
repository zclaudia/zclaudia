import type { ActiveRun } from '../conversation/transport/types.js';
import {
  computeBlockers,
  recomputePhase,
} from '../conversation/runtime/active-run-phase.js';

/**
 * Clear a pending permission request from whichever active run holds it.
 *
 * Clears the timeout, drops the pending entry, recomputes the run's phase
 * (the permission blocker is gone) and flips the session's persisted
 * `last_run_status` back to `running`. Returns true when a run held the
 * request, false when no run has it pending.
 */
export function clearPendingPermissionFromActiveRun(
  activeRuns: Map<string, ActiveRun>,
  requestId: string
): boolean {
  for (const [, run] of activeRuns) {
    const pending = run.pendingPermissions.get(requestId);
    if (!pending) continue;
    if (pending.timeout) clearTimeout(pending.timeout);
    run.pendingPermissions.delete(requestId);
    recomputePhase(run, computeBlockers(run));
    run.db
      .prepare('UPDATE sessions SET last_run_status = ?, updated_at = ? WHERE id = ?')
      .run('running', Date.now(), run.sessionId);
    return true;
  }
  return false;
}
