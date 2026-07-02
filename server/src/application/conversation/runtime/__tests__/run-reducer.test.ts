import { describe, expect, it } from 'vitest';
import { PhaseEmitter } from '../active-run-phase.js';
import { createRunDomainEvent } from '../run-domain-events.js';
import { applyRunDomainEvent } from '../run-reducer.js';

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
    phase: 'running',
    phaseEmitter: new PhaseEmitter(),
    ...overrides,
  };
}

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
    seq: 1,
    source: 'provider',
    payload,
  });
}

describe('run reducer', () => {
  it('accumulates assistant text deltas into content and text blocks', () => {
    const run = buildRun();

    applyRunDomainEvent(run, event('assistant.textDelta', { content: 'hello' }));
    applyRunDomainEvent(run, event('assistant.textDelta', { content: ' world' }));

    expect(run.fullContent).toBe('hello world');
    expect(run.contentBlocks).toEqual([{ type: 'text', content: 'hello world' }]);
  });

  it('starts tool calls by recording history, collected calls, and content block order', () => {
    const run = buildRun({
      recentToolCalls: Array.from({ length: 20 }, (_, index) => `old-${index}`),
    });

    applyRunDomainEvent(
      run,
      event('tool.started', {
        toolUseId: 'tool-1',
        toolName: 'Read',
        input: { file_path: '/repo/src/app.ts' },
        semantic: 'plan_proposal',
      })
    );

    expect(run.recentToolCalls).toHaveLength(20);
    expect(run.recentToolCalls[0]).toBe('old-1');
    expect(run.recentToolCalls[19]).toBe('Read:src/app.ts');
    expect(run.collectedToolCalls).toEqual([
      {
        toolUseId: 'tool-1',
        name: 'Read',
        input: { file_path: '/repo/src/app.ts' },
        effect: undefined,
      },
    ]);
    expect(run.contentBlocks).toEqual([{ type: 'tool_use', toolUseId: 'tool-1' }]);
  });

  it('finishes tool calls by backfilling output, error state, and effect', () => {
    const effect = { kind: 'file_write', path: '/repo/src/app.ts' } as any;
    const run = buildRun({
      collectedToolCalls: [
        { toolUseId: 'tool-1', name: 'Edit', input: { file_path: '/repo/src/app.ts' } },
      ],
    });

    applyRunDomainEvent(
      run,
      event('tool.finished', {
        toolUseId: 'tool-1',
        toolName: 'Edit',
        output: 'patched',
        isError: false,
        effect,
      })
    );

    expect(run.collectedToolCalls[0]).toEqual({
      toolUseId: 'tool-1',
      name: 'Edit',
      input: { file_path: '/repo/src/app.ts' },
      output: 'patched',
      isError: false,
      effect,
    });
  });

  it('accumulates thinking deltas and metadata', () => {
    const run = buildRun({ thinkingBlocks: undefined });

    applyRunDomainEvent(run, event('assistant.thinkingDelta', { content: 'reason' }));
    applyRunDomainEvent(run, event('assistant.thinkingDelta', { content: 'ing' }));
    applyRunDomainEvent(
      run,
      event('assistant.thinkingDelta', { signature: 'sig-1', redacted: false })
    );

    expect(run.thinkingBlocks).toEqual([
      { text: 'reasoning', signature: 'sig-1', redacted: false },
    ]);
  });

  it('tracks background task blockers and recomputes phase', () => {
    const run = buildRun();

    applyRunDomainEvent(run, event('backgroundTask.started', { taskId: 'task-1' }));
    expect(run.pendingBackgroundTasks).toBe(1);
    expect(run.phase).toBe('awaiting_followup');

    applyRunDomainEvent(
      run,
      event('backgroundTask.finished', {
        taskId: 'task-1',
        status: 'completed',
      })
    );
    expect(run.pendingBackgroundTasks).toBe(0);
    expect(run.phase).toBe('running');
  });
});
