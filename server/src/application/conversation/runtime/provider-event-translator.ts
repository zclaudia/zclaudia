import type { UsageInfo } from '@zclaudia/shared/core/message';
import type { ProviderRuntimeEvent } from '../../../infra/providers/message-types.js';
import {
  createRunDomainEvent,
  type RunDomainEvent,
  type RunDomainEventType,
} from './run-domain-events.js';

export interface TranslateProviderRuntimeEventInput {
  event: ProviderRuntimeEvent;
  eventId?: string;
  occurredAt?: number;
  runId: string;
  sessionId: string;
  providerType?: string;
  seq: number;
}

export function translateProviderRuntimeEvent(
  input: TranslateProviderRuntimeEventInput
): RunDomainEvent[] {
  const { event } = input;
  switch (event.type) {
    case 'assistant':
    case 'assistant_delta':
      return event.content
        ? [domainEvent(input, 'assistant.textDelta', { content: event.content })]
        : [];

    case 'thinking_delta':
      return [
        domainEvent(input, 'assistant.thinkingDelta', {
          content: event.thinkingContent,
          signature: event.thinkingSignature,
          redacted: event.thinkingRedacted,
        }),
      ];

    case 'tool_use':
    case 'tool_started':
      return [
        domainEvent(
          input,
          'tool.started',
          {
            toolUseId: event.toolUseId || '',
            toolName: event.toolName || '',
            input: event.toolInput,
            semantic: event.toolSemantic,
            effect: event.toolEffect,
          },
          { toolUseId: event.toolUseId }
        ),
      ];

    case 'tool_activity':
      return event.toolUseId && event.content
        ? [
            domainEvent(
              input,
              'tool.activity',
              {
                toolUseId: event.toolUseId,
                content: event.content,
              },
              { toolUseId: event.toolUseId }
            ),
          ]
        : [];

    case 'tool_result':
    case 'tool_finished':
      return [
        domainEvent(
          input,
          'tool.finished',
          {
            toolUseId: event.toolUseId || '',
            toolName: event.toolName || '',
            output: event.toolResult,
            isError: event.isToolError,
            effect: event.toolEffect,
          },
          { toolUseId: event.toolUseId }
        ),
      ];

    case 'result':
    case 'provider_turn_finished':
      return [
        domainEvent(input, 'run.providerTurnFinished', {
          content: event.content,
          usage: event.usage as UsageInfo | undefined,
        }),
      ];

    case 'retry_scheduled':
      return event.retryInfo
        ? [
            domainEvent(input, 'run.retryScheduled', {
              attempt: event.retryInfo.attempt,
              maxAttempts: event.retryInfo.maxAttempts,
              delayMs: event.retryInfo.delayMs,
              ...(event.retryInfo.status !== undefined ? { status: event.retryInfo.status } : {}),
            }),
          ]
        : [];

    case 'error':
    case 'provider_error':
      return [
        domainEvent(input, 'run.failed', {
          error: event.error || 'Provider error',
          ...(event.errorCode ? { errorCode: event.errorCode } : {}),
        }),
      ];

    case 'mode_transition':
      return event.modeTransition
        ? [
            domainEvent(
              input,
              'mode.changed',
              {
                mode: event.modeTransition.mode,
                reason: event.modeTransition.reason,
              },
              { toolUseId: event.modeTransition.sourceToolUseId }
            ),
          ]
        : [];

    case 'task_notification':
      return translateTaskNotification(input);

    case 'init':
      return [];
  }
}

function translateTaskNotification(input: TranslateProviderRuntimeEventInput): RunDomainEvent[] {
  const { event } = input;
  const payload = {
    taskId: event.taskId,
    taskToolUseId: event.taskToolUseId,
  };
  const cause = {
    taskId: event.taskId,
    toolUseId: event.taskToolUseId,
  };

  if (event.taskStatus === 'started') {
    return [domainEvent(input, 'backgroundTask.started', payload, cause)];
  }
  if (
    event.taskStatus === 'completed' ||
    event.taskStatus === 'failed' ||
    event.taskStatus === 'stopped'
  ) {
    return [
      domainEvent(
        input,
        'backgroundTask.finished',
        {
          ...payload,
          status: event.taskStatus,
          message: event.taskMessage,
        },
        cause
      ),
    ];
  }
  return [
    domainEvent(
      input,
      'backgroundTask.updated',
      {
        ...payload,
        status: event.taskStatus,
        message: event.taskMessage,
      },
      cause
    ),
  ];
}

function domainEvent<TType extends RunDomainEventType>(
  input: TranslateProviderRuntimeEventInput,
  type: TType,
  payload: Parameters<typeof createRunDomainEvent<TType>>[0]['payload'],
  cause?: { toolUseId?: string; taskId?: string }
): RunDomainEvent<TType> {
  return createRunDomainEvent({
    eventId: input.eventId,
    type,
    occurredAt: input.occurredAt,
    runId: input.runId,
    sessionId: input.sessionId,
    providerType: input.providerType,
    seq: input.seq,
    source: 'provider',
    cause: {
      providerEventType: input.event.type,
      ...(cause?.toolUseId ? { toolUseId: cause.toolUseId } : {}),
      ...(cause?.taskId ? { taskId: cause.taskId } : {}),
    },
    payload,
  });
}
