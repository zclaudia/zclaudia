import type { InteractionMessage, NormalizedTodoItem } from '@zclaudia/shared/interaction/forms';
import type { MessageWithToolCalls } from '../../../stores/chatMessageStore';
import type { ToolCallState } from '../../../stores/runStore';
import { isTodoTool } from '../tool-call/toolClassifiers';
import {
  extractInteractionId,
  normalizeTodoItems,
  normalizeToolInput,
} from '../tool-call/toolFormatters';

export interface TodoSnapshot {
  todos: NormalizedTodoItem[];
  /** Persisted message carrying the update; null while it only exists in the live run. */
  messageId: string | null;
  /** True when the update belongs to the turn after the last user message. */
  fromLatestTurn: boolean;
}

export interface TodoSummary {
  done: number;
  total: number;
  allDone: boolean;
  /** The step being worked on, else the next pending one. */
  current: NormalizedTodoItem | null;
}

const STATUSES = new Set<NormalizedTodoItem['status']>([
  'pending',
  'in_progress',
  'completed',
  'cancelled',
]);

function coerce(items: { content: string; status: string }[]): NormalizedTodoItem[] {
  return items.map(item => ({
    content: item.content,
    status: STATUSES.has(item.status as NormalizedTodoItem['status'])
      ? (item.status as NormalizedTodoItem['status'])
      : 'pending',
  }));
}

type TaskTool = 'TaskCreate' | 'TaskUpdate';

// Bridged names carry a server prefix (`mcp__x__TaskCreate`, `x:TaskCreate`).
function taskTool(name: string): TaskTool | null {
  const bare = name.split(/__|:/).pop();
  return bare === 'TaskCreate' || bare === 'TaskUpdate' ? bare : null;
}

// A sub-agent's own checklist is not the session's plan.
function isTracked(toolCall: ToolCallState): boolean {
  if (toolCall.parentToolUseId) return false;
  return isTodoTool(toolCall.toolName) || taskTool(toolCall.toolName) !== null;
}

function todosFor(
  toolCall: ToolCallState,
  interactions: Record<string, InteractionMessage>
): NormalizedTodoItem[] {
  const interactionId = extractInteractionId(toolCall.result);
  const interaction =
    interactions[toolCall.id] ?? (interactionId ? interactions[interactionId] : undefined);
  // The server's copy wins: it carries auto-completed items the raw input doesn't.
  if (interaction?.type === 'interaction_todo_update' && interaction.todos.length > 0) {
    return interaction.todos;
  }
  return coerce(normalizeTodoItems(toolCall.toolInput));
}

function inputRecord(toolCall: ToolCallState): Record<string, unknown> {
  const input = normalizeToolInput(toolCall.toolInput);
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

// "Task #3 created successfully: …" — the id later TaskUpdate calls refer to.
function createdTaskId(toolCall: ToolCallState): string {
  const text = typeof toolCall.result === 'string' ? toolCall.result : '';
  return text.match(/#(\d+)/)?.[1] ?? `pending:${toolCall.id}`;
}

interface Located {
  toolCall: ToolCallState;
  messageId: string | null;
  /** Position in `messages`; live-only calls sort after every message. */
  index: number;
}

/**
 * Current task list for a session, rebuilt by replaying its updates in
 * order. Two styles exist: TodoWrite-like tools send the whole list each time,
 * while Claude's TaskCreate/TaskUpdate edit one task at a time — the style of
 * the most recent update decides which list is shown. Calls that don't parse
 * yet (input still streaming, or failed) are skipped so the last good list
 * stays up.
 */
export function findLatestTodoSnapshot(params: {
  sessionId: string;
  messages: MessageWithToolCalls[];
  liveToolCalls: ToolCallState[];
  interactions: Record<string, InteractionMessage>;
}): TodoSnapshot | null {
  const { sessionId, messages, liveToolCalls, interactions } = params;

  // A streaming assistant message and the live run carry the same calls; keep
  // the message's position but the live copy, which may be fresher.
  const located = new Map<string, Located>();
  messages.forEach((message, index) => {
    for (const toolCall of message.toolCalls ?? []) {
      if (isTracked(toolCall)) located.set(toolCall.id, { toolCall, messageId: message.id, index });
    }
  });
  for (const toolCall of liveToolCalls) {
    if (!isTracked(toolCall)) continue;
    const existing = located.get(toolCall.id);
    located.set(
      toolCall.id,
      existing ? { ...existing, toolCall } : { toolCall, messageId: null, index: messages.length }
    );
  }

  let list: NormalizedTodoItem[] = [];
  const tasks = new Map<string, NormalizedTodoItem>();
  let latest: { at: Located; style: 'list' | 'tasks' } | null = null;

  for (const at of [...located.values()].sort((a, b) => a.index - b.index)) {
    const { toolCall } = at;
    if (toolCall.isError) continue;
    const tool = taskTool(toolCall.toolName);
    if (tool === null) {
      const todos = todosFor(toolCall, interactions);
      if (todos.length === 0) continue;
      list = todos;
      latest = { at, style: 'list' };
      continue;
    }
    const input = inputRecord(toolCall);
    if (tool === 'TaskCreate') {
      if (typeof input.subject !== 'string' || !input.subject) continue;
      tasks.set(createdTaskId(toolCall), { content: input.subject, status: 'pending' });
    } else {
      const id = String(input.taskId ?? '');
      const task = tasks.get(id);
      if (!task) continue;
      if (input.status === 'deleted') {
        tasks.delete(id);
      } else {
        tasks.set(id, {
          content:
            typeof input.subject === 'string' && input.subject ? input.subject : task.content,
          status: STATUSES.has(input.status as NormalizedTodoItem['status'])
            ? (input.status as NormalizedTodoItem['status'])
            : task.status,
        });
      }
    }
    latest = { at, style: 'tasks' };
  }

  if (latest) {
    const todos = latest.style === 'list' ? list : [...tasks.values()];
    if (todos.length === 0) return null;
    let lastUserIndex = -1;
    messages.forEach((message, index) => {
      if (message.role === 'user') lastUserIndex = index;
    });
    return {
      todos,
      messageId: latest.at.messageId,
      fromLatestTurn: latest.at.index > lastUserIndex,
    };
  }

  // MCP-bridge updates can land before any tool call is visible.
  const pending = Object.values(interactions)
    .filter(
      (item): item is Extract<InteractionMessage, { type: 'interaction_todo_update' }> =>
        item.sessionId === sessionId &&
        item.type === 'interaction_todo_update' &&
        item.todos.length > 0
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  return pending ? { todos: pending.todos, messageId: null, fromLatestTurn: true } : null;
}

export function summarizeTodos(todos: NormalizedTodoItem[]): TodoSummary {
  const done = todos.filter(t => t.status === 'completed' || t.status === 'cancelled').length;
  const current =
    todos.find(t => t.status === 'in_progress') ?? todos.find(t => t.status === 'pending') ?? null;
  return { done, total: todos.length, allDone: todos.length > 0 && done === todos.length, current };
}

/** Gap the floating panel keeps from the chat pane's edges. */
export const TODO_PANEL_EDGE = 8;
const EDGE = TODO_PANEL_EDGE;

export type Offset = { top: number; right: number };
/** Largest offsets that keep the whole panel inside the chat pane. */
export type Bounds = { maxTop: number; maxRight: number };

export function clampOffset(offset: Offset, bounds: Bounds | null): Offset {
  if (!bounds) return offset;
  return {
    top: Math.min(Math.max(EDGE, offset.top), Math.max(EDGE, bounds.maxTop)),
    right: Math.min(Math.max(EDGE, offset.right), Math.max(EDGE, bounds.maxRight)),
  };
}
