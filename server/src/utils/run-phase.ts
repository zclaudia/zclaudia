/**
 * Pure lifecycle-phase primitives for ActiveRun. Extracted from
 * application/conversation/runtime/active-run-phase.ts so lower layers
 * (utils / infra / domains) can share the same phase vocabulary without
 * importing the application runtime.
 *
 * Only the pure type + predicate + transition-table pieces live here; the
 * PhaseEmitter state machine stays in active-run-phase.ts.
 */
export type RunPhase =
  | 'running' // active turn: agent emitting deltas / tool calls
  | 'awaiting_permission' // permission request enqueued, waiting for user
  | 'awaiting_followup' // pendingBackgroundTasks > 0, pi will emit follow-up
  | 'cancelling' // user abort triggered, cleanup pending
  | 'finalizing' // final assistant snapshot is being persisted/published
  | 'completed' // terminal: normal completion (success)
  | 'cancelled' // terminal: user-initiated cancel, cleanup OK
  | 'failed'; // terminal: error termination (provider / runtime / cleanup-itself-errored)

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
  running: [
    'awaiting_permission',
    'awaiting_followup',
    'cancelling',
    'finalizing',
    'completed',
    'failed',
  ],
  awaiting_permission: [
    'running',
    'awaiting_followup',
    'cancelling',
    'finalizing',
    'completed',
    'failed',
  ],
  awaiting_followup: [
    'running',
    'awaiting_permission',
    'cancelling',
    'finalizing',
    'completed',
    'failed',
  ],
  cancelling: ['cancelled', 'failed'],
  finalizing: ['completed', 'failed'],
  completed: [],
  cancelled: [],
  failed: [],
};

export function isValidTransition(from: RunPhase, to: RunPhase): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}
