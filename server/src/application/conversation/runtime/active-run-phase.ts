/**
 * Lifecycle phase of an ActiveRun. Replaces the scattered
 * `completed: boolean` + `pendingPermissions.size > 0` + `abortController.aborted`
 * + `pendingBackgroundTasks > 0` checks with a single explicit field.
 *
 * Transitions are validated. In development NODE_ENV, invalid transitions
 * throw so test runs catch state-machine bugs early. In production they
 * warn and refuse the transition (a partially-shut-down run shouldn't
 * crash the process).
 */
export type RunPhase =
  | 'running'              // active turn: agent emitting deltas / tool calls
  | 'awaiting_permission'  // permission request enqueued, waiting for user
  | 'awaiting_followup'    // pendingBackgroundTasks > 0, pi will emit follow-up
  | 'cancelling'           // user abort triggered, cleanup pending
  | 'completed'            // terminal: normal completion (success)
  | 'cancelled'            // terminal: user-initiated cancel, cleanup OK
  | 'failed';              // terminal: error termination (provider / runtime / cleanup-itself-errored)

export const TERMINAL_PHASES: ReadonlySet<RunPhase> = new Set(['completed', 'cancelled', 'failed']);

export function isTerminalPhase(p: RunPhase): boolean {
  return TERMINAL_PHASES.has(p);
}

/**
 * Valid transitions table. Design:
 * - 'running' is the hub (can go to any other phase)
 * - awaiting_* states can return to running, swap, or terminate
 * - 'cancelling' only goes to 'cancelled' (normal) or 'failed' (cleanup errored)
 * - terminal states are sinks
 */
const VALID_TRANSITIONS: Record<RunPhase, ReadonlyArray<RunPhase>> = {
  running:             ['awaiting_permission', 'awaiting_followup', 'cancelling', 'completed', 'failed'],
  awaiting_permission: ['running', 'awaiting_followup', 'cancelling', 'completed', 'failed'],
  awaiting_followup:   ['running', 'awaiting_permission', 'cancelling', 'completed', 'failed'],
  cancelling:          ['cancelled', 'failed'],
  completed:           [],
  cancelled:           [],
  failed:              [],
};

export function isValidTransition(from: RunPhase, to: RunPhase): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

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
    return () => { this.listeners.delete(fn); };
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
  if (isTerminalPhase(run.phase)) return;
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
 * Promise that resolves with the terminal phase when reached.
 * Rejects on timeout. If already terminal, resolves synchronously.
 */
export function waitForIdle(
  run: PhaseHolder,
  options?: { timeoutMs?: number },
): Promise<RunPhase> {
  return new Promise((resolve, reject) => {
    if (isTerminalPhase(run.phase)) {
      resolve(run.phase);
      return;
    }

    let timer: NodeJS.Timeout | null = null;
    const off = run.phaseEmitter.onChange((next) => {
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
