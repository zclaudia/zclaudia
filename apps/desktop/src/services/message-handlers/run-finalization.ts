import type { ContentBlock } from '@zclaudia/shared';
import { useRunStore } from '../../stores/runStore';
import { flushDeltaForRun } from './delta-buffer';

export interface AuthoritativeRunSnapshot {
  sessionId?: string;
  assistantMessageId?: string;
  messageVersion?: number;
  content?: string;
  contentBlocks?: ContentBlock[];
  error?: string;
}

export interface FinalizeRunResult {
  sessionId?: string;
  assistantMessageId?: string;
}

/**
 * The single client-side terminal transition for run content.
 *
 * Every completion, failure, heartbeat cleanup, and reconciliation cleanup
 * must come through here so buffered deltas are committed before the
 * authoritative snapshot is applied and run-local state is discarded.
 */
export function finalizeRunLifecycle(
  runId: string,
  final?: AuthoritativeRunSnapshot
): FinalizeRunResult {
  const snapshot = final ?? {};
  const before = useRunStore.getState();
  const sessionId = snapshot.sessionId ?? before.activeRuns[runId];
  const assistantMessageId = snapshot.assistantMessageId ?? before.assistantMessageIds[runId];

  flushDeltaForRun(runId);

  if (sessionId) {
    if (final !== undefined || !before.activeRuns[runId]) {
      useRunStore.getState().finalizeRunToMessage(runId, {
        ...snapshot,
        sessionId,
        ...(assistantMessageId ? { assistantMessageId } : {}),
      });
    } else {
      useRunStore.getState().finalizeRunToMessage(runId);
    }
  }

  useRunStore.getState().endRun(runId);
  return { sessionId, assistantMessageId };
}
