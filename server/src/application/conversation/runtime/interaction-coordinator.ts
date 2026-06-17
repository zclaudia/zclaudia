import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { ProviderRuntimeEvent } from '../../../infra/providers/types.js';
import type { ActiveRun } from '../transport/types.js';
import { normalizeFromToolUse } from '../interactions/interaction-normalizer.js';
import { finalizeSession, trackAndAutoComplete } from '../interactions/todo-state-tracker.js';

export interface HandleToolUseInteractionInput {
  activeRun: ActiveRun;
  msg: ProviderRuntimeEvent;
  providerType: string;
  runId: string;
  sendRunEvent: (event: ServerMessage) => void;
  sessionId: string;
}

export interface FinalizeRunInteractionsInput {
  activeRun: ActiveRun;
  providerType: string;
  runId: string;
  sendRunEvent: (event: ServerMessage) => void;
  sessionId: string;
}

export function handleToolUseInteraction(input: HandleToolUseInteractionInput): void {
  const { activeRun, msg, providerType, runId, sendRunEvent, sessionId } = input;
  const todoInteraction = normalizeFromToolUse({
    sessionId: activeRun.sessionId,
    runId,
    providerType,
    toolUseId: msg.toolUseId || '',
    toolName: msg.toolName || '',
    toolInput: msg.toolInput,
    interactionKind: msg.toolInteractionKind,
  });
  if (!todoInteraction) return;

  for (const update of trackAndAutoComplete(sessionId, todoInteraction.interactionId, todoInteraction.todos)) {
    sendRunEvent(buildTodoUpdateMessage({
      activeRun,
      providerType,
      runId,
      update,
    }));
  }
  sendRunEvent(todoInteraction);
}

export function finalizeRunInteractions(input: FinalizeRunInteractionsInput): void {
  const { activeRun, providerType, runId, sendRunEvent, sessionId } = input;
  for (const update of finalizeSession(sessionId)) {
    sendRunEvent(buildTodoUpdateMessage({
      activeRun,
      providerType,
      runId,
      update,
    }));
  }
}

function buildTodoUpdateMessage(input: {
  activeRun: ActiveRun;
  providerType: string;
  runId: string;
  update: { interactionId: string; todos: import('@zclaudia/shared/interaction/forms').NormalizedTodoItem[] };
}): Extract<ServerMessage, { type: 'interaction_todo_update' }> {
  const { activeRun, providerType, runId, update } = input;
  return {
    type: 'interaction_todo_update',
    interactionId: update.interactionId,
    sessionId: activeRun.sessionId,
    runId,
    provider: providerType,
    source: 'tool_call',
    createdAt: Date.now(),
    todos: update.todos,
  };
}
