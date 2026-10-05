import { useMemo } from 'react';
import { useRunStore } from '../../stores/runStore';
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
 * The drawer's extra data, resolved client-side from the run's tool calls.
 * A background sub-agent carries the tool_use_id of the Task call that
 * spawned it; that call still holds the full prompt in its input and, once
 * it settles, the agent's final report as its result. Runs are scanned
 * without a runId because the background task itself doesn't record one —
 * tool_use_ids are unique per call, so the first Task match is the one.
 *
 * The selector returns the stored ToolCallState itself (referentially
 * stable across unrelated updates); the prompt/result projection is memo'd
 * on top so the hook never hands back a fresh object per snapshot.
 */
export function useSubagentDetail(task: BackgroundTask | null): SubagentDetail | null {
  const toolCall = useRunStore(state =>
    task?.toolUseId ? (findOriginatingTaskCall(state, task.toolUseId) ?? null) : null
  );
  return useMemo(() => {
    if (!toolCall) return null;
    const input = toolCall.toolInput as { prompt?: unknown } | null;
    return {
      prompt: typeof input?.prompt === 'string' && input.prompt ? input.prompt : undefined,
      resultText: extractResultText(toolCall.result),
    };
  }, [toolCall]);
}
