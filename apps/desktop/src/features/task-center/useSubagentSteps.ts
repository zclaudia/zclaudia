import { useMemo } from 'react';
import { useRunStore } from '../../stores/runStore';
import type { ToolCallState } from '../../stores/runStore';
import type { BackgroundTask } from '../../stores/backgroundTaskStore';

/**
 * A background sub-agent's inner steps: every tool call whose
 * parentToolUseId names the Task call that spawned this agent (the lineage
 * field P5 plumbs through from the runtime). Ordered as they happened —
 * toolCallsHistory is rebuilt in transcript order on every run event, so
 * the running step sits at the end.
 *
 * The selector returns the store's stable record reference; the projection
 * is memo'd on top so consumers never get a fresh array per snapshot.
 * Runs are scanned without a runId, same contract as useSubagentDetail.
 */
export function useSubagentSteps(task: BackgroundTask | null): ToolCallState[] {
  const toolUseId = task?.toolUseId;
  const histories = useRunStore(state => (toolUseId ? state.toolCallsHistory : undefined));
  return useMemo(() => {
    if (!toolUseId || !histories) return [];
    const steps: ToolCallState[] = [];
    for (const history of Object.values(histories)) {
      for (const tc of history || []) {
        if (tc.parentToolUseId === toolUseId) steps.push(tc);
      }
    }
    return steps;
  }, [histories, toolUseId]);
}
