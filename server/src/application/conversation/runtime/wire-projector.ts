import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { RunDomainEvent } from './run-domain-events.js';

export function projectRunDomainEventToWireMessages(event: RunDomainEvent): ServerMessage[] {
  switch (event.type) {
    case 'run.started':
      return [
        {
          type: 'run_started',
          runId: event.runId,
          sessionId: event.sessionId,
          clientRequestId: event.payload.clientRequestId || event.runId,
          assistantMessageId: event.payload.assistantMessageId,
          userMessageId: event.payload.userMessageId,
          sessionType: event.payload.sessionType,
          effectiveProfile: event.payload.effectiveProfile,
          seq: event.seq,
        },
      ];

    case 'assistant.textDelta':
      return [
        {
          type: 'delta',
          runId: event.runId,
          sessionId: event.sessionId,
          content: event.payload.content,
          seq: event.seq,
        },
      ];

    case 'tool.started':
      return [
        {
          type: 'tool_use',
          runId: event.runId,
          sessionId: event.sessionId,
          toolUseId: event.payload.toolUseId,
          toolName: event.payload.toolName,
          toolInput: event.payload.input,
          semantic: event.payload.semantic,
          effect: event.payload.effect,
          seq: event.seq,
        },
      ];

    case 'tool.finished':
      return [
        {
          type: 'tool_result',
          runId: event.runId,
          sessionId: event.sessionId,
          toolUseId: event.payload.toolUseId,
          toolName: event.payload.toolName,
          result: event.payload.output,
          isError: event.payload.isError,
          effect: event.payload.effect,
          seq: event.seq,
        },
      ];

    case 'tool.activity':
      return [
        {
          type: 'tool_activity',
          runId: event.runId,
          sessionId: event.sessionId,
          toolUseId: event.payload.toolUseId,
          content: event.payload.content,
          seq: event.seq,
        },
      ];

    case 'mode.changed':
      return [
        {
          type: 'mode_change',
          runId: event.runId,
          sessionId: event.sessionId,
          mode: event.payload.mode,
          seq: event.seq,
        },
      ];

    case 'run.retryScheduled':
      return [
        {
          type: 'run_retrying',
          runId: event.runId,
          sessionId: event.sessionId,
          attempt: event.payload.attempt,
          maxAttempts: event.payload.maxAttempts,
          delayMs: event.payload.delayMs,
          ...(event.payload.status !== undefined ? { status: event.payload.status } : {}),
          seq: event.seq,
        },
      ];

    case 'run.completed':
      return [
        {
          type: 'run_completed',
          runId: event.runId,
          sessionId: event.sessionId,
          usage: event.payload.usage,
          assistantMessageId: event.payload.assistantMessageId,
          messageVersion: event.payload.messageVersion,
          content: event.payload.content,
          contentBlocks: event.payload.contentBlocks,
          seq: event.seq,
        },
      ];

    case 'run.failed':
      return [
        {
          type: 'run_failed',
          runId: event.runId,
          sessionId: event.sessionId,
          error: event.payload.error,
          ...(event.payload.assistantMessageId
            ? { assistantMessageId: event.payload.assistantMessageId }
            : {}),
          ...(event.payload.messageVersion !== undefined
            ? { messageVersion: event.payload.messageVersion }
            : {}),
          ...(event.payload.content !== undefined ? { content: event.payload.content } : {}),
          ...(event.payload.contentBlocks !== undefined
            ? { contentBlocks: event.payload.contentBlocks }
            : {}),
          ...(event.payload.errorCode ? { errorCode: event.payload.errorCode } : {}),
          seq: event.seq,
        },
      ];

    case 'compaction.completed':
      return [
        {
          type: 'compaction_completed',
          runId: event.runId,
          sessionId: event.sessionId,
          compactionId: event.payload.compactionId,
          tokensBefore: event.payload.tokensBefore,
        },
      ];

    case 'compaction.failed':
      return [
        {
          type: 'compaction_failed',
          runId: event.runId,
          sessionId: event.sessionId,
          reason: event.payload.reason,
          breakerOpen: event.payload.breakerOpen,
          nextRetryAtMs: event.payload.nextRetryAtMs,
        },
      ];

    case 'backgroundTask.started':
      return [
        {
          type: 'task_notification',
          runId: event.runId,
          sessionId: event.sessionId,
          taskId: event.payload.taskId,
          status: 'started',
          seq: event.seq,
        },
      ];

    case 'backgroundTask.updated':
      return [
        {
          type: 'task_notification',
          runId: event.runId,
          sessionId: event.sessionId,
          taskId: event.payload.taskId,
          status: event.payload.status,
          message: event.payload.message,
          seq: event.seq,
        },
      ];

    case 'backgroundTask.finished':
      return [
        {
          type: 'task_notification',
          runId: event.runId,
          sessionId: event.sessionId,
          taskId: event.payload.taskId,
          status: event.payload.status,
          message: event.payload.message,
          seq: event.seq,
        },
      ];

    default:
      return [];
  }
}
