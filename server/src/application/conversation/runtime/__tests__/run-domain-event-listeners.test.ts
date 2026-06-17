import { describe, expect, it, vi } from 'vitest';
import { createRunDomainEvent } from '../run-domain-events.js';

function event<TType extends Parameters<typeof createRunDomainEvent>[0]['type']>(
  type: TType,
  payload: Parameters<typeof createRunDomainEvent<TType>>[0]['payload'],
) {
  return createRunDomainEvent({
    eventId: `event-${type}`,
    type,
    runId: 'run-1',
    sessionId: 'session-1',
    providerType: 'zclaudia',
    seq: 1,
    source: 'provider',
    payload,
  });
}

describe('run domain event listeners', () => {
  it('emits public run domain events to registered listeners and supports unsubscribe', async () => {
    const { RunDomainEventListenerRegistry } = await import('../run-domain-event-listeners.js');
    const registry = new RunDomainEventListenerRegistry();
    const listener = vi.fn();

    const unsubscribe = registry.on('tool.started', listener);
    const toolStarted = event('tool.started', {
      toolUseId: 'tool-1',
      toolName: 'Read',
      input: { file_path: 'README.md' },
    });

    registry.emit(toolStarted);
    unsubscribe();
    registry.emit(toolStarted);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(toolStarted);
  });

  it('does not emit internal run domain events to external listeners', async () => {
    const { RunDomainEventListenerRegistry } = await import('../run-domain-event-listeners.js');
    const registry = new RunDomainEventListenerRegistry();
    const listener = vi.fn();

    registry.on('tool.started', listener);
    registry.emit(event('assistant.textDelta', { content: 'hidden from public hooks' }));

    expect(listener).not.toHaveBeenCalled();
  });

  it('rejects non-public event registrations at runtime', async () => {
    const { RunDomainEventListenerRegistry } = await import('../run-domain-event-listeners.js');
    const registry = new RunDomainEventListenerRegistry();

    expect(() => {
      registry.on('assistant.textDelta' as any, vi.fn());
    }).toThrow(/not a public run domain event/i);
  });

  it('isolates listener failures and reports them without stopping other listeners', async () => {
    const { RunDomainEventListenerRegistry } = await import('../run-domain-event-listeners.js');
    const onListenerError = vi.fn();
    const registry = new RunDomainEventListenerRegistry({ onListenerError });
    const failed = new Error('listener failed');
    const succeedingListener = vi.fn();

    registry.on('mode.changed', () => {
      throw failed;
    });
    registry.on('mode.changed', succeedingListener);

    const modeChanged = event('mode.changed', { mode: 'plan', reason: 'enter' });
    registry.emit(modeChanged);

    expect(succeedingListener).toHaveBeenCalledWith(modeChanged);
    expect(onListenerError).toHaveBeenCalledWith(failed, modeChanged);
  });
});
