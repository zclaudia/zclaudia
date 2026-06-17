import { beforeEach, describe, expect, it, vi } from 'vitest';

const normalizeFromToolUseMock = vi.fn();
const trackAndAutoCompleteMock = vi.fn();
const finalizeSessionMock = vi.fn();

vi.mock('../../interactions/interaction-normalizer.js', () => ({
  normalizeFromToolUse: normalizeFromToolUseMock,
}));

vi.mock('../../interactions/todo-state-tracker.js', () => ({
  finalizeSession: finalizeSessionMock,
  trackAndAutoComplete: trackAndAutoCompleteMock,
}));

describe('interaction coordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes tool_use todos, emits auto-complete updates first, then the current interaction', async () => {
    const sendRunEvent = vi.fn();
    const currentTodos = [{ content: 'B', status: 'pending' }];
    const previousTodos = [{ content: 'A', status: 'completed' }];
    normalizeFromToolUseMock.mockReturnValueOnce({
      type: 'interaction_todo_update',
      interactionId: 'tool-2',
      sessionId: 'session-1',
      runId: 'run-1',
      provider: 'zclaudia',
      source: 'tool_call',
      createdAt: 100,
      todos: currentTodos,
    });
    trackAndAutoCompleteMock.mockReturnValueOnce([
      { interactionId: 'tool-1', todos: previousTodos },
    ]);

    const { handleToolUseInteraction } = await import('../interaction-coordinator.js');

    handleToolUseInteraction({
      activeRun: { sessionId: 'session-1' } as any,
      msg: {
        type: 'tool_use',
        toolUseId: 'tool-2',
        toolName: 'TodoWrite',
        toolInput: { todos: currentTodos },
        toolInteractionKind: 'todo_update',
      } as any,
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent,
      sessionId: 'session-1',
    });

    expect(normalizeFromToolUseMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      runId: 'run-1',
      providerType: 'zclaudia',
      toolUseId: 'tool-2',
      toolName: 'TodoWrite',
      toolInput: { todos: currentTodos },
      interactionKind: 'todo_update',
    });
    expect(trackAndAutoCompleteMock).toHaveBeenCalledWith('session-1', 'tool-2', currentTodos);
    expect(sendRunEvent.mock.calls.map(([event]) => event)).toEqual([
      {
        type: 'interaction_todo_update',
        interactionId: 'tool-1',
        sessionId: 'session-1',
        runId: 'run-1',
        provider: 'zclaudia',
        source: 'tool_call',
        createdAt: expect.any(Number),
        todos: previousTodos,
      },
      {
        type: 'interaction_todo_update',
        interactionId: 'tool-2',
        sessionId: 'session-1',
        runId: 'run-1',
        provider: 'zclaudia',
        source: 'tool_call',
        createdAt: 100,
        todos: currentTodos,
      },
    ]);
  });

  it('emits finalized todo updates when a run completes', async () => {
    const sendRunEvent = vi.fn();
    const finalizedTodos = [{ content: 'A', status: 'completed' }];
    finalizeSessionMock.mockReturnValueOnce([
      { interactionId: 'tool-1', todos: finalizedTodos },
    ]);

    const { finalizeRunInteractions } = await import('../interaction-coordinator.js');

    finalizeRunInteractions({
      activeRun: { sessionId: 'session-1' } as any,
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent,
      sessionId: 'session-1',
    });

    expect(finalizeSessionMock).toHaveBeenCalledWith('session-1');
    expect(sendRunEvent).toHaveBeenCalledWith({
      type: 'interaction_todo_update',
      interactionId: 'tool-1',
      sessionId: 'session-1',
      runId: 'run-1',
      provider: 'zclaudia',
      source: 'tool_call',
      createdAt: expect.any(Number),
      todos: finalizedTodos,
    });
  });
});
