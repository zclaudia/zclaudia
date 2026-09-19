// Cross-store effects of run lifecycle transitions in runStore. The store's
// actions delegate here so runStore stays a plain state container (stores must
// not import other stores; services coordinate them).
import type { ContentBlock } from '@zclaudia/shared';
import { useChatMessageStore, findLastAssistantMessageIndex } from '../stores/chatMessageStore';
import type { ToolCallState } from '../stores/runTypes';
import { useSessionConfigStore } from '../stores/sessionConfigStore';

/** Server-authoritative terminal snapshot from run_completed and friends. */
export interface RunFinalizationSnapshot {
  sessionId?: string;
  assistantMessageId?: string;
  messageVersion?: number;
  content?: string;
  contentBlocks?: ContentBlock[];
  error?: string;
}

/** Everything applyRunFinalizationToChatMessage needs, precomputed by runStore. */
export interface RunFinalizationTarget {
  sessionId: string;
  /** The session runStore tracked the run under; null for late terminal events. */
  trackedSessionId: string | undefined;
  assistantMessageId: string | undefined;
  runHistory: ToolCallState[];
  blocks: ContentBlock[];
  final?: RunFinalizationSnapshot;
}

/**
 * Finalize run data (tool calls + content blocks) onto the assistant message
 * in one atomic update. Prefers existing data when it's more complete (e.g.,
 * from API/metadata loaded before a mid-stream join).
 */
export function applyRunFinalizationToChatMessage(target: RunFinalizationTarget): void {
  const { sessionId, trackedSessionId, assistantMessageId, runHistory, blocks, final } = target;
  useChatMessageStore.setState(state => {
    const sessionMessages = state.messages[sessionId] || [];
    if (sessionMessages.length === 0) return state;
    // Legacy events without an assistantMessageId may only use the old
    // last-assistant fallback while the run is still actively tracked. A
    // late terminal event for an old run must never overwrite a newer run.
    const assistantIdx = assistantMessageId
      ? sessionMessages.findIndex(message => message.id === assistantMessageId)
      : trackedSessionId
        ? findLastAssistantMessageIndex(sessionMessages)
        : -1;
    if (assistantIdx === -1) return state;
    const assistantMessage = sessionMessages[assistantIdx];
    const existingToolCalls = assistantMessage.toolCalls || [];
    const toolCalls =
      runHistory.length >= existingToolCalls.length ? [...runHistory] : existingToolCalls;
    const existingBlocks = assistantMessage.contentBlocks || [];
    const contentBlocks = final?.contentBlocks?.length
      ? [...final.contentBlocks]
      : blocks.length >= existingBlocks.length
        ? [...blocks]
        : existingBlocks;
    let content = final?.content !== undefined ? final.content : assistantMessage.content;
    if (final?.error && !content.includes(`**Error:** ${final.error}`)) {
      content += `\n\n**Error:** ${final.error}`;
    }
    const updatedMessages = [
      ...sessionMessages.slice(0, assistantIdx),
      { ...assistantMessage, content, toolCalls, contentBlocks },
      ...sessionMessages.slice(assistantIdx + 1),
    ];
    const existingPagination = state.pagination[sessionId];
    const pagination =
      final?.messageVersion != null
        ? {
            ...state.pagination,
            [sessionId]: {
              ...(existingPagination ?? { total: sessionMessages.length, hasMore: false }),
              messageVersion: Math.max(
                final.messageVersion,
                existingPagination?.messageVersion ?? 0
              ),
              isLoadingMore: false,
            },
          }
        : state.pagination;
    return { messages: { ...state.messages, [sessionId]: updatedMessages }, pagination };
  });
}

/** Clear the per-run runtime mode once the run ends. */
export function clearSessionRuntimeMode(sessionId: string): void {
  useSessionConfigStore.getState().clearRuntimeMode(sessionId);
}
