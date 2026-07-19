import { describe, expect, it } from 'vitest';
import { createRunDomainEvent } from '../run-domain-events.js';
import { projectRunDomainEventToWireMessages } from '../wire-projector.js';

function event<TType extends Parameters<typeof createRunDomainEvent>[0]['type']>(
  type: TType,
  payload: Parameters<typeof createRunDomainEvent<TType>>[0]['payload']
) {
  return createRunDomainEvent({
    eventId: `event-${type}`,
    type,
    occurredAt: 123,
    runId: 'run-1',
    sessionId: 'session-1',
    providerType: 'zclaudia',
    seq: 9,
    source: 'runtime',
    payload,
  });
}

describe('wire projector', () => {
  it('projects assistant and tool events to existing run wire messages', () => {
    expect(
      projectRunDomainEventToWireMessages(
        event('assistant.textDelta', {
          content: 'hello',
        })
      )
    ).toEqual([
      { type: 'delta', runId: 'run-1', sessionId: 'session-1', content: 'hello', seq: 9 },
    ]);

    expect(
      projectRunDomainEventToWireMessages(
        event('tool.started', {
          toolUseId: 'tool-1',
          toolName: 'Read',
          input: { file_path: 'README.md' },
          semantic: 'plan_proposal',
        })
      )
    ).toEqual([
      {
        type: 'tool_use',
        runId: 'run-1',
        sessionId: 'session-1',
        toolUseId: 'tool-1',
        toolName: 'Read',
        toolInput: { file_path: 'README.md' },
        semantic: 'plan_proposal',
        effect: undefined,
        seq: 9,
      },
    ]);

    expect(
      projectRunDomainEventToWireMessages(
        event('tool.finished', {
          toolUseId: 'tool-1',
          toolName: 'Read',
          output: 'contents',
          isError: false,
        })
      )
    ).toEqual([
      {
        type: 'tool_result',
        runId: 'run-1',
        sessionId: 'session-1',
        toolUseId: 'tool-1',
        toolName: 'Read',
        result: 'contents',
        isError: false,
        effect: undefined,
        seq: 9,
      },
    ]);
  });

  it('projects lifecycle, retry, and mode events to existing wire messages', () => {
    expect(
      projectRunDomainEventToWireMessages(
        event('run.completed', {
          usage: undefined,
          assistantMessageId: 'assistant-1',
          messageVersion: 7,
        })
      )
    ).toEqual([
      {
        type: 'run_completed',
        runId: 'run-1',
        sessionId: 'session-1',
        usage: undefined,
        assistantMessageId: 'assistant-1',
        messageVersion: 7,
        content: undefined,
        contentBlocks: undefined,
        seq: 9,
      },
    ]);

    expect(
      projectRunDomainEventToWireMessages(
        event('run.completed', {
          usage: undefined,
          assistantMessageId: 'assistant-1',
          messageVersion: 7,
          content: 'final text',
          contentBlocks: [
            { type: 'tool_use', toolUseId: 'tool-1' },
            { type: 'text', content: 'final text' },
          ],
        })
      )
    ).toEqual([
      {
        type: 'run_completed',
        runId: 'run-1',
        sessionId: 'session-1',
        usage: undefined,
        assistantMessageId: 'assistant-1',
        messageVersion: 7,
        content: 'final text',
        contentBlocks: [
          { type: 'tool_use', toolUseId: 'tool-1' },
          { type: 'text', content: 'final text' },
        ],
        seq: 9,
      },
    ]);

    expect(
      projectRunDomainEventToWireMessages(
        event('run.failed', {
          error: 'provider error',
          errorCode: 'BAD_MODEL',
        })
      )
    ).toEqual([
      {
        type: 'run_failed',
        runId: 'run-1',
        sessionId: 'session-1',
        error: 'provider error',
        errorCode: 'BAD_MODEL',
        seq: 9,
      },
    ]);

    expect(
      projectRunDomainEventToWireMessages(
        event('run.retryScheduled', {
          attempt: 2,
          maxAttempts: 3,
          delayMs: 1000,
          status: 529,
        })
      )
    ).toEqual([
      {
        type: 'run_retrying',
        runId: 'run-1',
        sessionId: 'session-1',
        attempt: 2,
        maxAttempts: 3,
        delayMs: 1000,
        status: 529,
        seq: 9,
      },
    ]);

    expect(
      projectRunDomainEventToWireMessages(
        event('mode.changed', {
          mode: 'plan',
          reason: 'enter',
        })
      )
    ).toEqual([
      { type: 'mode_change', runId: 'run-1', sessionId: 'session-1', mode: 'plan', seq: 9 },
    ]);
  });

  it('projects compaction and background task events to existing wire messages', () => {
    expect(
      projectRunDomainEventToWireMessages(
        event('compaction.completed', {
          compactionId: 'compaction-1',
          tokensBefore: 1234,
        })
      )
    ).toEqual([
      {
        type: 'compaction_completed',
        runId: 'run-1',
        sessionId: 'session-1',
        compactionId: 'compaction-1',
        tokensBefore: 1234,
      },
    ]);

    expect(
      projectRunDomainEventToWireMessages(
        event('backgroundTask.finished', {
          taskId: 'task-1',
          status: 'completed',
          message: 'done',
        })
      )
    ).toEqual([
      {
        type: 'task_notification',
        runId: 'run-1',
        sessionId: 'session-1',
        taskId: 'task-1',
        status: 'completed',
        message: 'done',
        seq: 9,
      },
    ]);
  });

  it('does not project internal-only provider turn events to wire messages', () => {
    expect(
      projectRunDomainEventToWireMessages(
        event('run.providerTurnFinished', {
          content: 'done',
          usage: undefined,
        })
      )
    ).toEqual([]);
  });
});
