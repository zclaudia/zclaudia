import type { Message } from '@zclaudia/shared';
import type { MessageWithToolCalls } from '../stores/chatMessageStore';

/**
 * Restore tool calls and content blocks from persisted metadata when loading
 * messages from the server.
 *
 * Server wire messages carry blocks/tool calls only under `metadata`; the
 * top-level `contentBlocks`/`toolCalls` fields the segmented message view
 * renders from are client-side and must be rebuilt here. Every path that
 * feeds server-fetched messages into the chat store (initial load, pagination,
 * gap fill, tail recovery) must hydrate through this function — otherwise a
 * recovery merge repairs `content` invisibly while the rendered blocks stay
 * stale.
 */
export function restoreToolCalls(messages: Message[]): MessageWithToolCalls[] {
  return messages.map(msg => {
    const result: MessageWithToolCalls = { ...msg };
    if (msg.metadata?.toolCalls && msg.metadata.toolCalls.length > 0) {
      result.toolCalls = msg.metadata.toolCalls.map((tc, i) => ({
        id: tc.toolUseId || `persisted-${msg.id}-${i}`,
        toolName: tc.name,
        toolInput: tc.input,
        status: tc.isError ? ('error' as const) : ('completed' as const),
        result: tc.output,
        isError: tc.isError,
        effect: tc.effect,
      }));
    }
    if (msg.metadata?.contentBlocks && msg.metadata.contentBlocks.length > 0) {
      result.contentBlocks = msg.metadata.contentBlocks;
    }
    return result;
  });
}
