import { describe, expect, it } from 'vitest';
import {
  createRunDomainEvent,
  isPublicRunDomainEventType,
  PUBLIC_RUN_DOMAIN_EVENT_TYPES,
  RUN_DOMAIN_EVENT_TYPES,
} from '../run-domain-events.js';

describe('run domain events', () => {
  it('exports the canonical run domain event catalog', () => {
    expect(RUN_DOMAIN_EVENT_TYPES).toEqual([
      'run.started',
      'run.providerTurnFinished',
      'run.retryScheduled',
      'run.completed',
      'run.failed',
      'run.cancelled',
      'run.finalized',
      'assistant.textDelta',
      'assistant.thinkingDelta',
      'assistant.thinkingFinalized',
      'assistant.outputFallbackApplied',
      'assistant.truncationSuspected',
      'tool.started',
      'tool.activity',
      'tool.finished',
      'tool.failed',
      'tool.effectDetected',
      'interaction.todoUpdated',
      'interaction.todoAutoCompleted',
      'interaction.promptRequested',
      'interaction.resolved',
      'mode.changed',
      'mode.aiInitiatedPlanEntered',
      'mode.aiInitiatedPlanExited',
      'backgroundTask.started',
      'backgroundTask.updated',
      'backgroundTask.finished',
      'backgroundTask.pidResolved',
      'backgroundFollowup.started',
      'backgroundFollowup.finished',
      'compaction.requested',
      'compaction.completed',
      'compaction.failed',
      'compaction.skipped',
      'permission.requested',
      'permission.resolved',
      'permission.autoResolved',
      'run.phaseChanged',
    ]);
  });

  it('marks only stable extension-safe events as public by default', () => {
    expect(PUBLIC_RUN_DOMAIN_EVENT_TYPES).toEqual([
      'run.started',
      'run.completed',
      'run.failed',
      'tool.started',
      'tool.finished',
      'mode.changed',
      'backgroundTask.started',
      'backgroundTask.finished',
      'backgroundFollowup.started',
      'backgroundFollowup.finished',
      'compaction.completed',
      'compaction.failed',
      'interaction.todoUpdated',
      'interaction.promptRequested',
      'interaction.resolved',
      'permission.requested',
      'permission.resolved',
      'permission.autoResolved',
      'run.phaseChanged',
    ]);
    expect(isPublicRunDomainEventType('run.completed')).toBe(true);
    expect(isPublicRunDomainEventType('backgroundFollowup.started')).toBe(true);
    expect(isPublicRunDomainEventType('permission.requested')).toBe(true);
    expect(isPublicRunDomainEventType('interaction.promptRequested')).toBe(true);
    expect(isPublicRunDomainEventType('run.phaseChanged')).toBe(true);
    expect(isPublicRunDomainEventType('assistant.textDelta')).toBe(false);
    expect(isPublicRunDomainEventType('run.providerTurnFinished')).toBe(false);
  });

  it('creates a versioned envelope around domain event payloads', () => {
    const event = createRunDomainEvent({
      eventId: 'event-1',
      type: 'tool.started',
      occurredAt: 123,
      runId: 'run-1',
      sessionId: 'session-1',
      providerType: 'zclaudia',
      seq: 7,
      source: 'provider',
      cause: {
        providerEventType: 'tool_use',
        toolUseId: 'tool-1',
      },
      payload: {
        toolUseId: 'tool-1',
        toolName: 'Read',
        input: { file_path: 'README.md' },
      },
    });

    expect(event).toEqual({
      eventId: 'event-1',
      type: 'tool.started',
      version: 1,
      occurredAt: 123,
      runId: 'run-1',
      sessionId: 'session-1',
      providerType: 'zclaudia',
      seq: 7,
      source: 'provider',
      cause: {
        providerEventType: 'tool_use',
        toolUseId: 'tool-1',
      },
      payload: {
        toolUseId: 'tool-1',
        toolName: 'Read',
        input: { file_path: 'README.md' },
      },
    });
  });
});
