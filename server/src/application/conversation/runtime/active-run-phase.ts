/**
 * Lifecycle phase of an ActiveRun. Replaces the scattered
 * `completed: boolean` + `pendingPermissions.size > 0` + `abortController.aborted`
 * + `pendingBackgroundTasks > 0` checks with a single explicit field.
 *
 * The pure phase vocabulary (RunPhase, isTerminalPhase, isValidTransition)
 * lives in utils/run-phase.ts so lower layers can share it; re-exported here
 * for existing consumers.
 *
 * Transitions are validated. In development NODE_ENV, invalid transitions
 * throw so test runs catch state-machine bugs early. In production they
 * warn and refuse the transition (a partially-shut-down run shouldn't
 * crash the process).
 */
import { isTerminalPhase, isValidTransition, type RunPhase } from '../../../utils/run-phase.js';

export { isTerminalPhase, isValidTransition, TERMINAL_PHASES } from '../../../utils/run-phase.js';
export type { RunPhase } from '../../../utils/run-phase.js';

type PhaseListener = (next: RunPhase, prev: RunPhase) => void;

/**
 * Tiny observable for phase changes. Used by waitForIdle and (future)
 * I48 queue priming / I49 tool gating / I50 typed hook events.
 *
 * Errors thrown by listeners are caught + warned so one bad listener
 * can't break the run.
 */
export class PhaseEmitter {
  private listeners = new Set<PhaseListener>();

  onChange(fn: PhaseListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(next: RunPhase, prev: RunPhase): void {
    for (const fn of this.listeners) {
      try {
        fn(next, prev);
      } catch (err) {
        console.warn('[PhaseEmitter] listener threw:', err);
      }
    }
  }
}

export interface PhaseHolder {
  phase: RunPhase;
  phaseEmitter: PhaseEmitter;
  runId: string;
}

/**
 * Transition the run to `next`. Same-phase = noop. Invalid transitions
 * warn (prod) or throw (NODE_ENV=development) and refuse the change.
 */
export function setPhase(run: PhaseHolder, next: RunPhase): void {
  const prev = run.phase;
  if (prev === next) return;

  if (!isValidTransition(prev, next)) {
    const msg = `[ActiveRun ${run.runId}] illegal phase transition: ${prev} → ${next}`;
    if (process.env.NODE_ENV === 'development') {
      throw new Error(msg);
    }
    console.warn(msg);
    return;
  }

  run.phase = next;
  run.phaseEmitter.emit(next, prev);
}

export interface PhaseBlockers {
  hasPendingPermissions: boolean;
  hasPendingFollowups: boolean;
  isCancelling: boolean;
}

/**
 * Compute the right phase given concurrent blockers. Priority:
 *   cancelling > awaiting_permission > awaiting_followup > running
 *
 * Used when a single trigger (e.g. permission resolved) might still leave
 * the run waiting on something else (background task still in flight).
 *
 * Terminal phases are sticky — recomputePhase is a no-op for them.
 */
export function recomputePhase(run: PhaseHolder, blockers: PhaseBlockers): void {
  if (isTerminalPhase(run.phase) || run.phase === 'finalizing') return;
  if (blockers.isCancelling) {
    setPhase(run, 'cancelling');
    return;
  }
  if (blockers.hasPendingPermissions) {
    setPhase(run, 'awaiting_permission');
    return;
  }
  if (blockers.hasPendingFollowups) {
    setPhase(run, 'awaiting_followup');
    return;
  }
  setPhase(run, 'running');
}

/**
 * Inspect an ActiveRun-like object for the three concurrent blockers
 * `recomputePhase` cares about. Exported so callsites that mutate any of
 * (pendingPermissions, pendingBackgroundTasks, abortController) can call
 * `recomputePhase(activeRun, computeBlockers(activeRun))` without manually
 * assembling the bag.
 */
export function computeBlockers(run: {
  abortController?: AbortController;
  pendingPermissions: Map<unknown, unknown>;
  pendingBackgroundTasks?: number;
}): PhaseBlockers {
  return {
    isCancelling: !!run.abortController?.signal.aborted,
    hasPendingPermissions: run.pendingPermissions.size > 0,
    hasPendingFollowups: (run.pendingBackgroundTasks ?? 0) > 0,
  };
}

/**
 * Promise that resolves with the terminal phase when reached.
 * Rejects on timeout. If already terminal, resolves synchronously.
 */
export function waitForIdle(run: PhaseHolder, options?: { timeoutMs?: number }): Promise<RunPhase> {
  return new Promise((resolve, reject) => {
    if (isTerminalPhase(run.phase)) {
      resolve(run.phase);
      return;
    }

    let timer: NodeJS.Timeout | null = null;
    const off = run.phaseEmitter.onChange(next => {
      if (isTerminalPhase(next)) {
        if (timer) clearTimeout(timer);
        off();
        resolve(next);
      }
    });

    if (options?.timeoutMs) {
      timer = setTimeout(() => {
        off();
        reject(new Error(`waitForIdle timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);
    }
  });
}
