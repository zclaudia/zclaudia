import { describe, expect, it, vi } from 'vitest';
import { dispatchProviderRuntimeEventToDomain } from '../run-domain-dispatcher.js';
import { RunDomainEventListenerRegistry } from '../run-domain-event-listeners.js';

function buildRun(overrides: Record<string, unknown> = {}): any {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    providerType: 'zclaudia',
    fullContent: '',
    contentBlocks: [],
    thinkingBlocks: [],
    collectedToolCalls: [],
    recentToolCalls: [],
    pendingPermissions: new Map(),
    pendingBackgroundTasks: 0,
    eventSeq: 41,
    ...overrides,
  };
}

describe('run domain dispatcher', () => {
  it('translates provider events, applies reducer state, and emits wire projections', () => {
    const activeRun = buildRun();
    const sendRunEvent = vi.fn();

    const events = dispatchProviderRuntimeEventToDomain({
      activeRun,
      providerEvent: { type: 'assistant_delta', content: 'hello' },
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent,
    } as any);

    expect(events.map(event => event.type)).toEqual(['assistant.textDelta']);
    expect(activeRun.fullContent).toBe('hello');
    expect(activeRun.contentBlocks).toEqual([{ type: 'text', content: 'hello' }]);
    expect(sendRunEvent).toHaveBeenCalledWith({
      type: 'delta',
      runId: 'run-1',
      sessionId: 'session-1',
      content: 'hello',
    });
  });

  it('does not emit internal-only domain events as wire messages', () => {
    const activeRun = buildRun();
    const sendRunEvent = vi.fn();

    const events = dispatchProviderRuntimeEventToDomain({
      activeRun,
      providerEvent: { type: 'result', content: 'done' },
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent,
    } as any);

    expect(events.map(event => event.type)).toEqual(['run.providerTurnFinished']);
    expect(sendRunEvent).not.toHaveBeenCalled();
  });

  it('emits public domain events to the listener registry', () => {
    const activeRun = buildRun();
    const sendRunEvent = vi.fn();
    const listeners = new RunDomainEventListenerRegistry();
    const listener = vi.fn();
    listeners.on('tool.started', listener);

    const events = dispatchProviderRuntimeEventToDomain({
      activeRun,
      providerEvent: {
        type: 'tool_started',
        toolUseId: 'tool-1',
        toolName: 'Read',
        toolInput: { file_path: 'README.md' },
      },
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent,
      listeners,
    } as any);

    expect(events.map(event => event.type)).toEqual(['tool.started']);
    expect(listener).toHaveBeenCalledWith(events[0]);
  });
});
