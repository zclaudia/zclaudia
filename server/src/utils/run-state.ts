import {
  isTerminalPhase,
  type RunPhase,
} from '../application/conversation/runtime/active-run-phase.js';

type RunLike = {
  sessionId?: string;
  phase: RunPhase;
  sessionType?: string;
};

/**
 * Foreground active run means:
 * - phase is non-terminal (still in flight)
 * - not background session
 */
export function isForegroundActiveRun(run: RunLike | undefined): boolean {
  if (!run) return false;
  return !isTerminalPhase(run.phase) && run.sessionType !== 'background';
}

export function hasForegroundActiveRunForSession(
  activeRuns: Map<string, RunLike>,
  sessionId: string
): boolean {
  for (const run of activeRuns.values()) {
    if (run.sessionId === sessionId && isForegroundActiveRun(run)) {
      return true;
    }
  }
  return false;
}

export function findForegroundActiveRunIdForSession(
  activeRuns: Map<string, RunLike>,
  sessionId: string
): string | null {
  for (const [runId, run] of activeRuns) {
    if (run.sessionId === sessionId && isForegroundActiveRun(run)) {
      return runId;
    }
  }
  return null;
}

/**
 * Any non-terminal run (foreground or background) for the given session.
 */
export function hasAnyActiveRunForSession(
  activeRuns: Map<string, RunLike>,
  sessionId: string
): boolean {
  for (const run of activeRuns.values()) {
    if (run.sessionId === sessionId && !isTerminalPhase(run.phase)) {
      return true;
    }
  }
  return false;
}

/** Gateway wire status for one session. */
export type GatewaySessionRunStatus = 'idle' | 'running' | 'waiting' | 'failed';

/**
 * What the gateway should report for a session.
 *
 * A live foreground run wins, but it alone can only ever say "running" — the
 * states clients actually need to act on (blocked on the user, or ended badly)
 * live in `sessions.last_run_status`, which outlives the in-memory run. Without
 * folding that in, remote clients can never see `waiting` or `failed`.
 */
export function resolveSessionRunStatus(
  activeRuns: Map<string, RunLike>,
  sessionId: string,
  persisted: string | null | undefined
): GatewaySessionRunStatus {
  if (persisted === 'waiting') return 'waiting';
  if (hasForegroundActiveRunForSession(activeRuns, sessionId)) return 'running';
  if (persisted === 'failed') return 'failed';
  return 'idle';
}
