import type {
  CompactionMarker,
  ContextUsagePayload,
  FilePushMetadata,
} from '@zclaudia/shared/core/message';
import type { MessageWithToolCalls } from '../../../stores/chatMessageStore';
import { tryParseMessageInput } from '../../../utils/messageContent';

/** Which protocol sentinel (if any) a message row carries in its metadata. */
export type MessageClassification =
  | { kind: 'compactionMarker'; marker: CompactionMarker }
  | { kind: 'contextUsage'; usage: ContextUsagePayload }
  | { kind: 'filePush'; filePush: FilePushMetadata }
  | { kind: 'message' };

/**
 * Discriminate the message-protocol metadata sentinels (compaction marker,
 * /context usage card, file push) from regular messages. The check order is
 * load-bearing — it mirrors the render dispatch order in MessageList.
 */
export function classifyMessage(message: MessageWithToolCalls): MessageClassification {
  // Compaction markers ride on synthetic system messages with empty content.
  if (message.metadata?.compactionMarker) {
    return { kind: 'compactionMarker', marker: message.metadata.compactionMarker };
  }
  // /context cards ride on synthetic, frontend-only system messages.
  if (message.metadata?.contextUsage) {
    return { kind: 'contextUsage', usage: message.metadata.contextUsage };
  }
  if (message.metadata?.filePush) {
    return { kind: 'filePush', filePush: message.metadata.filePush };
  }
  return { kind: 'message' };
}

/**
 * Filter out empty messages (permission approvals, empty inputs, placeholder
 * assistant messages). Compaction markers and /context cards ride on synthetic
 * system messages with empty content, so they would otherwise be filtered out
 * below — keep them by detecting the metadata sentinel.
 */
export function filterRenderableMessages(messages: MessageWithToolCalls[]): MessageWithToolCalls[] {
  return (messages || []).filter(message => {
    // Compaction markers and /context cards always pass — even though their role is 'system' and content is empty.
    if (message.metadata?.compactionMarker) return true;
    if (message.metadata?.contextUsage) return true;

    // Filter out empty assistant messages (placeholders from run_started that never received content)
    if (message.role === 'assistant') {
      const hasContent = message.content.trim().length > 0;
      const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;
      const hasBlocks = message.contentBlocks && message.contentBlocks.length > 0;
      return hasContent || hasToolCalls || hasBlocks;
    }

    // Keep all other non-user messages (system, etc.)
    if (message.role !== 'user') {
      return true;
    }

    const parsed = tryParseMessageInput(message.content);
    const textContent = parsed?.text ?? message.content;
    const hasAttachments =
      (parsed?.attachments?.length ?? 0) > 0 || (message.metadata?.attachments?.length ?? 0) > 0;
    return textContent.trim().length > 0 || hasAttachments;
  });
}
