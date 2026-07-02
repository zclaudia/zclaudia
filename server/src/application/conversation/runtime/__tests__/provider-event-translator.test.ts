import { describe, expect, it } from 'vitest';
import { translateProviderRuntimeEvent } from '../provider-event-translator.js';

const base = {
  eventId: 'domain-event-1',
  occurredAt: 456,
  runId: 'run-1',
  sessionId: 'session-1',
  providerType: 'zclaudia',
  seq: 3,
} as const;

describe('provider-event-translator', () => {
  it('maps assistant deltas into assistant.textDelta domain events', () => {
    const events = translateProviderRuntimeEvent({
      ...base,
      event: { type: 'assistant', content: 'hello' },
    });

    expect(events).toEqual([
      {
        eventId: 'domain-event-1',
        type: 'assistant.textDelta',
        version: 1,
        occurredAt: 456,
        runId: 'run-1',
        sessionId: 'session-1',
        providerType: 'zclaudia',
        seq: 3,
        source: 'provider',
        cause: { providerEventType: 'assistant' },
        payload: { content: 'hello' },
      },
    ]);
  });

  it('maps tool use and tool result events into tool domain events', () => {
    expect(
      translateProviderRuntimeEvent({
        ...base,
        event: {
          type: 'tool_use',
          toolUseId: 'tool-1',
          toolName: 'Read',
          toolInput: { file_path: 'README.md' },
          toolSemantic: 'plan_proposal',
        },
      })
    ).toEqual([
      expect.objectContaining({
        type: 'tool.started',
        cause: { providerEventType: 'tool_use', toolUseId: 'tool-1' },
        payload: {
          toolUseId: 'tool-1',
          toolName: 'Read',
          input: { file_path: 'README.md' },
          semantic: 'plan_proposal',
        },
      }),
    ]);

    expect(
      translateProviderRuntimeEvent({
        ...base,
        event: {
          type: 'tool_result',
          toolUseId: 'tool-1',
          toolName: 'Read',
          toolResult: 'file contents',
          isToolError: false,
        },
      })
    ).toEqual([
      expect.objectContaining({
        type: 'tool.finished',
        cause: { providerEventType: 'tool_result', toolUseId: 'tool-1' },
        payload: {
          toolUseId: 'tool-1',
          toolName: 'Read',
          output: 'file contents',
          isError: false,
        },
      }),
    ]);
  });

  it('maps provider terminal and retry events into run domain events', () => {
    expect(
      translateProviderRuntimeEvent({
        ...base,
        event: {
          type: 'result',
          content: 'done',
          usage: {
            input: 1,
            output: 2,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 3,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          } as any,
        },
      })
    ).toEqual([
      expect.objectContaining({
        type: 'run.providerTurnFinished',
        payload: expect.objectContaining({ content: 'done' }),
      }),
    ]);

    expect(
      translateProviderRuntimeEvent({
        ...base,
        event: { type: 'error', error: 'bad model', errorCode: 'MODEL_NOT_FOUND' },
      })
    ).toEqual([
      expect.objectContaining({
        type: 'run.failed',
        payload: { error: 'bad model', errorCode: 'MODEL_NOT_FOUND' },
      }),
    ]);

    expect(
      translateProviderRuntimeEvent({
        ...base,
        event: {
          type: 'retry_scheduled',
          retryInfo: { attempt: 2, maxAttempts: 3, delayMs: 1000, status: 529 },
        },
      })
    ).toEqual([
      expect.objectContaining({
        type: 'run.retryScheduled',
        payload: { attempt: 2, maxAttempts: 3, delayMs: 1000, status: 529 },
      }),
    ]);
  });

  it('maps provider mode transitions into mode.changed domain events', () => {
    const events = translateProviderRuntimeEvent({
      ...base,
      event: {
        type: 'mode_transition',
        modeTransition: { mode: 'plan', reason: 'enter', sourceToolUseId: 'tool-1' },
      },
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: 'mode.changed',
        cause: { providerEventType: 'mode_transition', toolUseId: 'tool-1' },
        payload: { mode: 'plan', reason: 'enter' },
      }),
    ]);
  });
});
