import { describe, expect, it, vi } from 'vitest';
import { PhaseEmitter, setPhase } from '../active-run-phase.js';
import { RunDomainEventListenerRegistry } from '../run-domain-event-listeners.js';

describe('run phase domain events', () => {
  it('emits run.phaseChanged when an attached run changes phase', async () => {
    const listeners = new RunDomainEventListenerRegistry();
    const listener = vi.fn();
    listeners.on('run.phaseChanged', listener);
    const run = {
      runId: 'run-1',
      sessionId: 'session-1',
      providerType: 'zclaudia',
      eventSeq: 0,
      phase: 'running',
      phaseEmitter: new PhaseEmitter(),
    } as any;
    const { attachRunPhaseDomainEventEmitter } = await import('../run-phase-domain-events.js');

    const detach = attachRunPhaseDomainEventEmitter(run, listeners);
    setPhase(run, 'awaiting_permission');
    detach();
    setPhase(run, 'running');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'run.phaseChanged',
      runId: 'run-1',
      sessionId: 'session-1',
      payload: {
        previousPhase: 'running',
        nextPhase: 'awaiting_permission',
      },
    }));
  });
});
