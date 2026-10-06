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

// Shapes captured from a real Claude runtime run.
function create(id: string, subject: string, taskNo?: number): ToolCallState {
  return {
    id,
    toolName: 'TaskCreate',
    toolInput: { subject, description: `${subject}.`, activeForm: `${subject}ing` },
    status: taskNo === undefined ? 'running' : 'completed',
    result: taskNo === undefined ? undefined : `Task #${taskNo} created successfully: ${subject}`,
  };
}

function update(id: string, taskId: string, fields: Record<string, unknown>): ToolCallState {
  return {
    id,
    toolName: 'TaskUpdate',
    toolInput: { taskId, ...fields },
    status: 'completed',
    result: `Updated task #${taskId} status`,
  };
}

describe('findLatestTodoSnapshot with TaskCreate/TaskUpdate', () => {
  it('builds the list from creates and applies status updates by task number', () => {
    const snapshot = findLatestTodoSnapshot({
      ...base,
      messages: [
        message('u1', 'user'),
        message('a1', 'assistant', [
          create('c1', 'Gather requirements', 1),
          create('c2', 'Draft outline', 2),
          create('c3', 'Write summary', 3),
          update('x1', '1', { status: 'in_progress' }),
          update('x2', '1', { status: 'completed' }),
          update('x3', '2', { status: 'in_progress' }),
        ]),
      ],
    });
    expect(snapshot).toEqual({
      todos: [
        { content: 'Gather requirements', status: 'completed' },
        { content: 'Draft outline', status: 'in_progress' },
        { content: 'Write summary', status: 'pending' },
      ],
      messageId: 'a1',
      fromLatestTurn: true,
    });
  });

  it('removes deleted tasks and picks up renames', () => {
    const snapshot = findLatestTodoSnapshot({
      ...base,
      liveToolCalls: [
        create('c1', 'A', 1),
        create('c2', 'B', 2),
        update('x1', '1', { status: 'deleted' }),
        update('x2', '2', { subject: 'B, renamed' }),
      ],
    });
    expect(snapshot?.todos).toEqual([{ content: 'B, renamed', status: 'pending' }]);
  });

  it('shows a task whose create has no result yet', () => {
    const snapshot = findLatestTodoSnapshot({ ...base, liveToolCalls: [create('c1', 'A')] });
    expect(snapshot?.todos).toEqual([{ content: 'A', status: 'pending' }]);
  });

  it('ignores failed calls and updates to unknown tasks', () => {
    const snapshot = findLatestTodoSnapshot({
      ...base,
      liveToolCalls: [
        create('c1', 'A', 1),
        { ...update('x1', '1', { status: 'completed' }), isError: true },
        update('x2', '9', { status: 'completed' }),
      ],
    });
    expect(snapshot?.todos).toEqual([{ content: 'A', status: 'pending' }]);
  });

  it('counts a call once when the streaming message and the live run both hold it', () => {
    const live = [create('c1', 'A', 1), update('x1', '1', { status: 'in_progress' })];
    const snapshot = findLatestTodoSnapshot({
      ...base,
      messages: [message('u1', 'user'), message('a1', 'assistant', [create('c1', 'A', 1)])],
      liveToolCalls: live,
    });
    expect(snapshot?.todos).toEqual([{ content: 'A', status: 'in_progress' }]);
    expect(snapshot?.messageId).toBeNull();
  });

  it('matches bridged tool names', () => {
    const snapshot = findLatestTodoSnapshot({
      ...base,
      liveToolCalls: [{ ...create('c1', 'A', 1), toolName: 'mcp__claude__TaskCreate' }],
    });
    expect(snapshot?.todos[0].content).toBe('A');
  });

  it('shows whichever style was updated last', () => {
    const todoWrite = todoCall('t1', [{ content: 'From TodoWrite', status: 'pending' }]);
    const tasksLast = findLatestTodoSnapshot({
      ...base,
      liveToolCalls: [todoWrite, create('c1', 'From tasks', 1)],
    });
    expect(tasksLast?.todos[0].content).toBe('From tasks');

    const listLast = findLatestTodoSnapshot({
      ...base,
      liveToolCalls: [create('c1', 'From tasks', 1), todoWrite],
    });
    expect(listLast?.todos[0].content).toBe('From TodoWrite');
  });

  it('returns null once every task is deleted', () => {
    expect(
      findLatestTodoSnapshot({
        ...base,
        liveToolCalls: [create('c1', 'A', 1), update('x1', '1', { status: 'deleted' })],
      })
    ).toBeNull();
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
