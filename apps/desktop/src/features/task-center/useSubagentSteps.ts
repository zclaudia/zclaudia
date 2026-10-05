import { useMemo } from 'react';
import { useRunStore } from '../../stores/runStore';
import { useChatMessageStore } from '../../stores/chatMessageStore';
import type { ToolCallState } from '../../stores/runStore';
import type { BackgroundTask } from '../../stores/backgroundTaskStore';

/**
 * A background sub-agent's inner steps: every tool call whose
 * parentToolUseId names the Task call that spawned this agent (the lineage
 * field P5 plumbs through from the runtime). Ordered as they happened —
 * toolCallsHistory is rebuilt in transcript order on every run event, so
 * the running step sits at the end.
 *
 * The run store purges a run's history at finalization, so terminal tasks
 * (which persist until dismissed) resolve their steps from the finalized
 * snapshot on the session's assistant message instead. Both sources keep
 * transcript order and tool_use_ids are unique, so a dedupe merge is stable.
 *
 * The selectors return the stores' stable record references; the projection
 * is memo'd on top so consumers never get a fresh array per snapshot.
 * Runs are scanned without a runId, same contract as useSubagentDetail.
 */
export function useSubagentSteps(task: BackgroundTask | null): ToolCallState[] {
  const toolUseId = task?.toolUseId;
  const histories = useRunStore(state => (toolUseId ? state.toolCallsHistory : undefined));
  const messagesMap = useChatMessageStore(state => state.messages);
  return useMemo(() => {
    if (!toolUseId) return [];
    const steps: ToolCallState[] = [];
    const seen = new Set<string>();
    const push = (tc: ToolCallState) => {
      if (seen.has(tc.id)) return;
      seen.add(tc.id);
      steps.push(tc);
    };
    if (histories) {
      for (const history of Object.values(histories)) {
        for (const tc of history || []) {
          if (tc.parentToolUseId === toolUseId) push(tc);
        }
      }
    }
    for (const sessionMessages of Object.values(messagesMap)) {
      for (const message of sessionMessages) {
        for (const tc of message.toolCalls || []) {
          if (tc.parentToolUseId === toolUseId) push(tc);
        }
      }
    }
    return steps;
  }, [histories, messagesMap, toolUseId]);
}
