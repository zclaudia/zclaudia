import type { InteractionMessage, NormalizedTodoItem } from '@zclaudia/shared/interaction/forms';
import type { MessageWithToolCalls } from '../../../stores/chatMessageStore';
import type { ToolCallState } from '../../../stores/runStore';
import { isTodoTool } from '../tool-call/toolClassifiers';
import { extractInteractionId, normalizeTodoItems } from '../tool-call/toolFormatters';

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

// A sub-agent's own checklist is not the session's plan.
function isMainTodoCall(toolCall: ToolCallState): boolean {
  return isTodoTool(toolCall.toolName) && !toolCall.parentToolUseId;
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

/**
 * Latest todo list for a session, newest source first: the live run's tool
 * calls, then persisted messages from the end. Updates whose input doesn't
 * parse yet (still streaming) are skipped so the previous list stays up.
 */
export function findLatestTodoSnapshot(params: {
  sessionId: string;
  messages: MessageWithToolCalls[];
  liveToolCalls: ToolCallState[];
  interactions: Record<string, InteractionMessage>;
}): TodoSnapshot | null {
  const { sessionId, messages, liveToolCalls, interactions } = params;

  for (let i = liveToolCalls.length - 1; i >= 0; i--) {
    const toolCall = liveToolCalls[i];
    if (!isMainTodoCall(toolCall)) continue;
    const todos = todosFor(toolCall, interactions);
    if (todos.length > 0) return { todos, messageId: null, fromLatestTurn: true };
  }

  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const toolCalls = messages[i].toolCalls ?? [];
    for (let j = toolCalls.length - 1; j >= 0; j--) {
      if (!isMainTodoCall(toolCalls[j])) continue;
      const todos = todosFor(toolCalls[j], interactions);
      if (todos.length > 0) {
        return { todos, messageId: messages[i].id, fromLatestTurn: i > lastUserIndex };
      }
    }
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
