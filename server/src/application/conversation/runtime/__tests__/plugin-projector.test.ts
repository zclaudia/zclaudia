import { describe, expect, it } from 'vitest';
import { createRunDomainEvent } from '../run-domain-events.js';
import { projectRunDomainEventToPluginEvents } from '../plugin-projector.js';

function event<TType extends Parameters<typeof createRunDomainEvent>[0]['type']>(
  type: TType,
  payload: Parameters<typeof createRunDomainEvent<TType>>[0]['payload'],
) {
  return createRunDomainEvent({
    eventId: `event-${type}`,
    type,
    occurredAt: 123,
    runId: 'run-1',
    sessionId: 'session-1',
    providerType: 'zclaudia',
    seq: 1,
    source: 'provider',
    payload,
  });
}

describe('plugin projector', () => {
  it('projects run.started to the legacy run.started plugin event', () => {
    expect(projectRunDomainEventToPluginEvents(event('run.started', {
      clientRequestId: 'req-1',
      assistantMessageId: 'assistant-1',
      userMessageId: 'user-1',
      sessionType: 'background',
      input: 'hello',
      llmProfileId: 'provider-1',
      providerType: 'claude',
    }))).toEqual([
      {
        name: 'run.started',
        payload: {
          runId: 'run-1',
          sessionId: 'session-1',
          input: 'hello',
          llmProfileId: 'provider-1',
          providerType: 'claude',
        },
      },
    ]);
  });

  it('projects tool.started to the legacy run.toolCall plugin event', () => {
    expect(projectRunDomainEventToPluginEvents(event('tool.started', {
      toolUseId: 'tool-1',
      toolName: 'Read',
      input: { file_path: 'README.md' },
    }))).toEqual([
      {
        name: 'run.toolCall',
        payload: {
          runId: 'run-1',
          sessionId: 'session-1',
          toolName: 'Read',
          toolUseId: 'tool-1',
          toolInput: { file_path: 'README.md' },
        },
      },
    ]);
  });

  it('projects tool.finished to the legacy run.toolResult plugin event', () => {
    expect(projectRunDomainEventToPluginEvents(event('tool.finished', {
      toolUseId: 'tool-1',
      toolName: 'Read',
      output: 'contents',
      isError: false,
    }))).toEqual([
      {
        name: 'run.toolResult',
        payload: {
          runId: 'run-1',
          sessionId: 'session-1',
          toolName: 'Read',
          toolUseId: 'tool-1',
          result: 'contents',
          isError: false,
        },
      },
    ]);
  });

  it('does not project internal assistant deltas to plugin events by default', () => {
    expect(projectRunDomainEventToPluginEvents(event('assistant.textDelta', {
      content: 'streaming',
    }))).toEqual([]);
  });
});
