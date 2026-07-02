import type { EventData, PluginEvent } from '../../../infra/events/index.js';
import type { RunDomainEvent } from './run-domain-events.js';

export interface PluginEventProjection {
  name: PluginEvent;
  payload: EventData;
}

export function projectRunDomainEventToPluginEvents(
  event: RunDomainEvent
): PluginEventProjection[] {
  switch (event.type) {
    case 'run.started':
      return [
        {
          name: 'run.started',
          payload: {
            runId: event.runId,
            sessionId: event.sessionId,
            input: event.payload.input,
            llmProfileId: event.payload.llmProfileId,
            providerType: event.payload.providerType,
          },
        },
      ];

    case 'tool.started':
      return [
        {
          name: 'run.toolCall',
          payload: {
            runId: event.runId,
            sessionId: event.sessionId,
            toolName: event.payload.toolName,
            toolUseId: event.payload.toolUseId,
            toolInput: event.payload.input,
          },
        },
      ];

    case 'tool.finished':
      return [
        {
          name: 'run.toolResult',
          payload: {
            runId: event.runId,
            sessionId: event.sessionId,
            toolName: event.payload.toolName,
            toolUseId: event.payload.toolUseId,
            result: event.payload.output,
            isError: event.payload.isError,
          },
        },
      ];

    case 'run.completed':
      return [
        {
          name: 'run.completed',
          payload: {
            runId: event.runId,
            sessionId: event.sessionId,
            usage: event.payload.usage,
          },
        },
      ];

    case 'run.failed':
      return [
        {
          name: 'run.error',
          payload: {
            runId: event.runId,
            sessionId: event.sessionId,
            error: event.payload.error,
          },
        },
      ];

    default:
      return [];
  }
}
