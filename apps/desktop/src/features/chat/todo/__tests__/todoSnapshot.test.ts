import { describe, it, expect } from 'vitest';
import type { InteractionMessage } from '@zclaudia/shared/interaction/forms';
import type { MessageWithToolCalls } from '../../../../stores/chatMessageStore';
import type { ToolCallState } from '../../../../stores/runStore';
import { findLatestTodoSnapshot, summarizeTodos } from '../todoSnapshot';

function todoCall(id: string, todos: unknown, extra: Partial<ToolCallState> = {}): ToolCallState {
  return { id, toolName: 'TodoWrite', toolInput: { todos }, status: 'completed', ...extra };
}

function message(
  id: string,
  role: 'user' | 'assistant',
  toolCalls: ToolCallState[] = []
): MessageWithToolCalls {
  return {
    id,
    sessionId: 's1',
    role,
    content: '',
    createdAt: 0,
    toolCalls,
  } as MessageWithToolCalls;
}

const base = { sessionId: 's1', messages: [], liveToolCalls: [], interactions: {} };

describe('findLatestTodoSnapshot', () => {
  it('returns null when the session has no todo updates', () => {
    expect(findLatestTodoSnapshot(base)).toBeNull();
  });

  it('prefers the live run over persisted messages', () => {
    const snapshot = findLatestTodoSnapshot({
      ...base,
      messages: [
        message('m1', 'assistant', [todoCall('t1', [{ content: 'Old', status: 'pending' }])]),
      ],
      liveToolCalls: [todoCall('t2', [{ content: 'New', status: 'in_progress' }])],
    });
    expect(snapshot).toEqual({
      todos: [{ content: 'New', status: 'in_progress' }],
      messageId: null,
      fromLatestTurn: true,
    });
  });

  it('takes the newest todo call in the newest message', () => {
    const snapshot = findLatestTodoSnapshot({
      ...base,
      messages: [
        message('m1', 'assistant', [todoCall('t1', [{ content: 'A', status: 'pending' }])]),
        message('m2', 'assistant', [
          todoCall('t2', [{ content: 'B', status: 'pending' }]),
          todoCall('t3', [{ content: 'C', status: 'completed' }]),
        ]),
      ],
    });
    expect(snapshot?.todos).toEqual([{ content: 'C', status: 'completed' }]);
    expect(snapshot?.messageId).toBe('m2');
  });

  it('skips updates whose input does not parse yet', () => {
    const snapshot = findLatestTodoSnapshot({
      ...base,
      messages: [
        message('m1', 'assistant', [todoCall('t1', [{ content: 'Kept', status: 'pending' }])]),
      ],
      liveToolCalls: [
        { id: 't2', toolName: 'TodoWrite', toolInput: '{"todos":[{"con', status: 'running' },
      ],
    });
    expect(snapshot?.todos).toEqual([{ content: 'Kept', status: 'pending' }]);
  });

  it('ignores todo lists written by sub-agents', () => {
    const snapshot = findLatestTodoSnapshot({
      ...base,
      liveToolCalls: [
        todoCall('t1', [{ content: 'Main', status: 'pending' }]),
        todoCall('t2', [{ content: 'Child', status: 'pending' }], { parentToolUseId: 'task-1' }),
      ],
    });
    expect(snapshot?.todos[0].content).toBe('Main');
  });

  it('uses the server interaction copy, which carries auto-completed items', () => {
    const interactions: Record<string, InteractionMessage> = {
      t1: {
        type: 'interaction_todo_update',
        interactionId: 't1',
        sessionId: 's1',
        createdAt: 1,
        todos: [{ content: 'A', status: 'completed' }],
      } as InteractionMessage,
    };
    const snapshot = findLatestTodoSnapshot({
      ...base,
      interactions,
      liveToolCalls: [todoCall('t1', [{ content: 'A', status: 'pending' }])],
    });
    expect(snapshot?.todos).toEqual([{ content: 'A', status: 'completed' }]);
  });

  it('coerces unknown statuses to pending', () => {
    const snapshot = findLatestTodoSnapshot({
      ...base,
      liveToolCalls: [todoCall('t1', [{ content: 'A', status: 'blocked' }])],
    });
    expect(snapshot?.todos[0].status).toBe('pending');
  });

  it('marks lists from before the last user message as not from the latest turn', () => {
    const snapshot = findLatestTodoSnapshot({
      ...base,
      messages: [
        message('m1', 'assistant', [todoCall('t1', [{ content: 'A', status: 'pending' }])]),
        message('m2', 'user'),
        message('m3', 'assistant'),
      ],
    });
    expect(snapshot?.fromLatestTurn).toBe(false);
  });

  it('falls back to a todo interaction with no visible tool call', () => {
    const interactions: Record<string, InteractionMessage> = {
      other: {
        type: 'interaction_todo_update',
        interactionId: 'other',
        sessionId: 's2',
        createdAt: 5,
        todos: [{ content: 'Elsewhere', status: 'pending' }],
      } as InteractionMessage,
      mine: {
        type: 'interaction_todo_update',
        interactionId: 'mine',
        sessionId: 's1',
        createdAt: 1,
        todos: [{ content: 'Bridge', status: 'pending' }],
      } as InteractionMessage,
    };
    expect(findLatestTodoSnapshot({ ...base, interactions })?.todos[0].content).toBe('Bridge');
  });
});

describe('summarizeTodos', () => {
  it('counts completed and cancelled as done and picks the active step', () => {
    expect(
      summarizeTodos([
        { content: 'A', status: 'completed' },
        { content: 'B', status: 'cancelled' },
        { content: 'C', status: 'pending' },
        { content: 'D', status: 'in_progress' },
      ])
    ).toEqual({
      done: 2,
      total: 4,
      allDone: false,
      current: { content: 'D', status: 'in_progress' },
    });
  });

  it('falls back to the next pending step and reports all done', () => {
    expect(summarizeTodos([{ content: 'A', status: 'pending' }]).current?.content).toBe('A');
    const done = summarizeTodos([{ content: 'A', status: 'completed' }]);
    expect(done.allDone).toBe(true);
    expect(done.current).toBeNull();
  });

  it('treats an empty list as not done', () => {
    expect(summarizeTodos([]).allDone).toBe(false);
  });
});
