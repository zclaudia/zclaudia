import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRunDomainEvent } from '../run-domain-events.js';
import { RunDomainEventListenerRegistry } from '../run-domain-event-listeners.js';

const pluginEventsEmitMock = vi.fn(async () => {});

vi.mock('../../../../infra/events/index.js', () => ({
  pluginEvents: {
    emit: pluginEventsEmitMock,
  },
}));

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

describe('plugin domain event listener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits legacy plugin events from public run domain events', async () => {
    const { registerPluginDomainEventListener } = await import('../plugin-domain-event-listener.js');
    const registry = new RunDomainEventListenerRegistry();
    const unsubscribe = registerPluginDomainEventListener(registry);

    registry.emit(event('tool.started', {
      toolUseId: 'tool-1',
      toolName: 'Read',
      input: { file_path: 'README.md' },
    }));

    expect(pluginEventsEmitMock).toHaveBeenCalledWith('run.toolCall', {
      runId: 'run-1',
      sessionId: 'session-1',
      toolName: 'Read',
      toolUseId: 'tool-1',
      toolInput: { file_path: 'README.md' },
    });

    unsubscribe();
    registry.emit(event('tool.started', {
      toolUseId: 'tool-1',
      toolName: 'Read',
      input: { file_path: 'README.md' },
    }));
    expect(pluginEventsEmitMock).toHaveBeenCalledTimes(1);
  });

  it('registers at most once for the same registry', async () => {
    const { registerPluginDomainEventListener } = await import('../plugin-domain-event-listener.js');
    const registry = new RunDomainEventListenerRegistry();

    registerPluginDomainEventListener(registry);
    registerPluginDomainEventListener(registry);
    registry.emit(event('tool.finished', {
      toolUseId: 'tool-1',
      toolName: 'Read',
      output: 'contents',
      isError: false,
    }));

    expect(pluginEventsEmitMock).toHaveBeenCalledTimes(1);
    expect(pluginEventsEmitMock).toHaveBeenCalledWith('run.toolResult', {
      runId: 'run-1',
      sessionId: 'session-1',
      toolName: 'Read',
      toolUseId: 'tool-1',
      result: 'contents',
      isError: false,
    });
  });
});
