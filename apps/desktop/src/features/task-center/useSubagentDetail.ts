import { useMemo } from 'react';
import { useRunStore } from '../../stores/runStore';
import { useChatMessageStore } from '../../stores/chatMessageStore';
import type { ToolCallState } from '../../stores/runStore';
import type { BackgroundTask } from '../../stores/backgroundTaskStore';

export interface SubagentDetail {
  /** Full prompt the parent agent handed to the sub-agent, when resolvable. */
  prompt?: string;
  /** The sub-agent's final report, once the originating Task call settles. */
  resultText?: string;
}

/** Best-effort text out of a tool result: plain string, text blocks, or details.text. */
function extractResultText(result: unknown): string | undefined {
  if (typeof result === 'string') return result || undefined;
  if (!result || typeof result !== 'object') return undefined;
  const record = result as Record<string, unknown>;
  const details = record.details as Record<string, unknown> | undefined;
  if (typeof details?.text === 'string' && details.text) return details.text;
  if (Array.isArray(record.content)) {
    const text = record.content
      .filter(
        (block): block is Record<string, unknown> => block !== null && typeof block === 'object'
      )
      .filter(block => block.type === 'text')
      .map(block => String(block.text ?? ''))
      .join('');
    if (text) return text;
  }
  return undefined;
}

function findOriginatingTaskCall(
  state: ReturnType<typeof useRunStore.getState>,
  toolUseId: string
): ToolCallState | undefined {
  for (const calls of Object.values(state.activeToolCalls ?? {})) {
    const hit = calls?.[toolUseId];
    if (hit?.toolName === 'Task') return hit;
  }
  for (const history of Object.values(state.toolCallsHistory ?? {})) {
    const hit = (history || []).find(tc => tc.id === toolUseId && tc.toolName === 'Task');
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The run store discards a run's tool calls at finalization — exactly when a
 * Task call settles. The finalized snapshot lives on in the session's
 * assistant message (`toolCalls`), so fall back to it for terminal tasks;
 * live tasks resolve from the run store as before.
 */
function findTaskCallInMessages(
  messages: ReturnType<typeof useChatMessageStore.getState>['messages'],
  toolUseId: string
): ToolCallState | undefined {
  for (const sessionMessages of Object.values(messages)) {
    for (const message of sessionMessages) {
      const hit = message.toolCalls?.find(tc => tc.id === toolUseId && tc.toolName === 'Task');
      if (hit) return hit;
    }
  }
  return undefined;
}

/**
 * The drawer's extra data, resolved client-side from the Task tool call that
 * spawned the sub-agent. A background sub-agent carries the tool_use_id of
 * that call; it holds the full prompt in its input and, once it settles, the
 * agent's final report as its result. Calls are scanned without a runId
 * because the background task itself doesn't record one — tool_use_ids are
 * unique per call, so the first Task match is the one.
 *
 * The selectors return stored references (referentially stable across
 * unrelated updates); the prompt/result projection is memo'd on top so the
 * hook never hands back a fresh object per snapshot.
 */
export function useSubagentDetail(task: BackgroundTask | null): SubagentDetail | null {
  const toolUseId = task?.toolUseId;
  const runToolCall = useRunStore(state =>
    toolUseId ? (findOriginatingTaskCall(state, toolUseId) ?? null) : null
  );
  const messagesMap = useChatMessageStore(state => state.messages);
  return useMemo(() => {
    if (!toolUseId) return null;
    const toolCall = runToolCall ?? findTaskCallInMessages(messagesMap, toolUseId) ?? null;
    if (!toolCall) return null;
    const input = toolCall.toolInput as { prompt?: unknown } | null;
    return {
      prompt: typeof input?.prompt === 'string' && input.prompt ? input.prompt : undefined,
      resultText: extractResultText(toolCall.result),
    };
  }, [runToolCall, messagesMap, toolUseId]);
}
