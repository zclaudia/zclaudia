import type { Usage } from '@earendil-works/pi-ai';
import type { ActiveRun } from '../transport/types.js';
import { getSessionMessageVersion, upsertAssistantMessage } from './run-lifecycle.js';

export interface AssistantTerminalSnapshot {
  assistantMessageId: string;
  messageVersion: number;
  content?: string;
  contentBlocks?: ActiveRun['contentBlocks'];
}

/**
 * Persist the authoritative assistant projection and describe exactly which
 * row/version a terminal event must apply. All successful completion paths use
 * this helper so a fallback path cannot accidentally emit an identity-less
 * terminal signal.
 */
export function persistAssistantTerminalSnapshot(
  run: ActiveRun,
  options?: { usage?: Usage; indexMetadata?: boolean }
): AssistantTerminalSnapshot {
  const messageVersion = upsertAssistantMessage(run, options);
  return buildAssistantTerminalSnapshot(run, messageVersion);
}

/** Describe an already-persisted assistant projection. */
export function buildAssistantTerminalSnapshot(
  run: ActiveRun,
  messageVersion = getSessionMessageVersion(run.db, run.sessionId)
): AssistantTerminalSnapshot {
  return {
    assistantMessageId: run.assistantMessageId,
    messageVersion,
    ...(run.fullContent ? { content: run.fullContent } : {}),
    ...(run.contentBlocks.length > 0 ? { contentBlocks: [...run.contentBlocks] } : {}),
  };
}
