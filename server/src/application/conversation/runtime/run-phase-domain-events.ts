import type { RunPhase, PhaseEmitter } from './active-run-phase.js';
import { createRunDomainEvent } from './run-domain-events.js';
import {
  runDomainEventListeners,
  type RunDomainEventListenerRegistry,
} from './run-domain-event-listeners.js';

export interface PhaseDomainEventRun {
  eventSeq?: number;
  flushPendingRunDeltas?: () => void;
  phaseEmitter: PhaseEmitter;
  providerType?: string;
  runId: string;
  sessionId: string;
}

export function attachRunPhaseDomainEventEmitter(
  run: PhaseDomainEventRun,
  listeners: RunDomainEventListenerRegistry = runDomainEventListeners
): () => void {
  return run.phaseEmitter.onChange((next: RunPhase, prev: RunPhase) => {
    run.flushPendingRunDeltas?.();
    const event = createRunDomainEvent({
      type: 'run.phaseChanged',
      runId: run.runId,
      sessionId: run.sessionId,
      providerType: run.providerType,
      seq: (run.eventSeq ?? 0) + 1,
      source: 'runtime',
      payload: {
        previousPhase: prev,
        nextPhase: next,
      },
    });
    listeners.emit(event);
  });
}
