import { create } from 'zustand';
import type { Message, ContentBlock } from '@zclaudia/shared/core/message';
import type { ToolCallState } from './runTypes';
import { hydrateMessagesForDisplay } from '../services/message-hydration';

export interface PaginationInfo {
  total: number;
  hasMore: boolean;
  oldestTimestamp?: number;
  newestTimestamp?: number;
  maxOffset?: number; // Highest message offset loaded (for gap detection)
  messageVersion?: number; // Monotonic server revision (detects same-offset updates)
  isLoadingMore: boolean;
}

// Extended message with tool calls for display
export interface MessageWithToolCalls extends Message {
  toolCalls?: ToolCallState[];
  contentBlocks?: ContentBlock[];
  clientMessageId?: string; // Client-generated message ID for dual dedup
}

const DEFAULT_PAGINATION: PaginationInfo = {
  total: 0,
  hasMore: false,
  isLoadingMore: false,
};

export function findLastAssistantMessageIndex(messages: MessageWithToolCalls[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return i;
  }
  return -1;
}

interface ChatMessageState {
  messages: Record<string, MessageWithToolCalls[]>;
  pagination: Record<string, PaginationInfo>;

  setMessages: (
    sessionId: string,
    messages: MessageWithToolCalls[],
    pagination?: Partial<Omit<PaginationInfo, 'isLoadingMore'>>
  ) => void;
  prependMessages: (
    sessionId: string,
    messages: MessageWithToolCalls[],
    pagination?: Partial<Omit<PaginationInfo, 'isLoadingMore'>>
  ) => void;
  appendMessages: (
    sessionId: string,
    messages: MessageWithToolCalls[],
    pagination?: Partial<Omit<PaginationInfo, 'isLoadingMore'>>
  ) => void;
  mergeMessages: (
    sessionId: string,
    messages: MessageWithToolCalls[],
    pagination?: Partial<Omit<PaginationInfo, 'isLoadingMore'>>
  ) => void;
  addMessage: (sessionId: string, message: MessageWithToolCalls) => void;
  updateMessageIdByClientMessageId: (
    sessionId: string,
    clientMessageId: string,
    newId: string
  ) => void;
  appendToLastMessage: (sessionId: string, content: string) => void;
  appendToMessage: (sessionId: string, messageId: string, content: string) => void;
  clearMessages: (sessionId: string) => void;
  setLoadingMore: (sessionId: string, loading: boolean) => void;
  getPagination: (sessionId: string) => PaginationInfo | undefined;
}

/**
 * Prevent a reconcile/patch merge from regressing an assistant message that is
 * still streaming. Server tail/gap/patch snapshots lag the live delta stream by
 * up to one periodic-save interval, so an incoming row can carry a stale prefix
 * of `content` (and fewer blocks/tool calls). A merge may only grow these, never
 * shrink them — mirroring finalizeRunToMessage's richness guard. The
 * authoritative terminal content is applied through finalizeRunToMessage, not
 * mergeMessages, so refusing to shrink here is always safe.
 */
function withoutContentRegression(
  existing: MessageWithToolCalls,
  merged: MessageWithToolCalls
): MessageWithToolCalls {
  if (
    typeof existing.content === 'string' &&
    typeof merged.content === 'string' &&
    merged.content.length < existing.content.length
  ) {
    merged.content = existing.content;
  }
  if ((existing.contentBlocks?.length ?? 0) > (merged.contentBlocks?.length ?? 0)) {
    merged.contentBlocks = existing.contentBlocks;
  }
  if ((existing.toolCalls?.length ?? 0) > (merged.toolCalls?.length ?? 0)) {
    merged.toolCalls = existing.toolCalls;
  }
  return merged;
}

// A user message shown before the server acknowledged it: still keyed by the
// client id it was sent with (run_started later renames it to the row id).
function isUnackedOptimistic(message: MessageWithToolCalls): boolean {
  return (
    message.role === 'user' && !!message.clientMessageId && message.id === message.clientMessageId
  );
}

/**
 * A history sync can return the persisted user row before run_started has
 * renamed the optimistic copy — slow runtime launches (Claude spawns a CLI)
 * leave seconds for that. Swap each unacknowledged copy for its row, pairing
 * by text oldest-first, so the message isn't shown twice and the later rename
 * finds the row already in place. The row keeps the client id for that lookup.
 */
function adoptOptimisticUserMessages(
  existing: MessageWithToolCalls[],
  incoming: MessageWithToolCalls[]
): MessageWithToolCalls[] {
  const pending = existing.flatMap((message, index) =>
    isUnackedOptimistic(message) ? [index] : []
  );
  if (pending.length === 0) return existing;
  const knownIds = new Set(existing.map(message => message.id));
  let adopted: MessageWithToolCalls[] | null = null;
  for (const row of incoming) {
    if (row.role !== 'user' || knownIds.has(row.id)) continue;
    const slot = pending.findIndex(index => existing[index].content.trim() === row.content.trim());
    if (slot === -1) continue;
    const [index] = pending.splice(slot, 1);
    adopted ??= [...existing];
    adopted[index] = { ...row, clientMessageId: existing[index].clientMessageId };
    knownIds.add(row.id);
  }
  return adopted ?? existing;
}

export const useChatMessageStore = create<ChatMessageState>((set, get) => ({
  messages: {},
  pagination: {},

  setMessages: (sessionId, messages, pagination) =>
    set(state => ({
      messages: {
        ...state.messages,
        [sessionId]: hydrateMessagesForDisplay(messages),
      },
      pagination: pagination
        ? {
            ...state.pagination,
            [sessionId]: {
              ...(state.pagination[sessionId] || DEFAULT_PAGINATION),
              ...pagination,
              isLoadingMore: false,
            },
          }
        : state.pagination,
    })),

  prependMessages: (sessionId, newMessages, pagination) =>
    set(state => {
      const existingMessages = state.messages[sessionId] || [];
      const hydratedNewMessages = hydrateMessagesForDisplay(newMessages);
      // Prepend new messages (older) to the beginning
      const combined = [...hydratedNewMessages, ...existingMessages];

      return {
        messages: { ...state.messages, [sessionId]: combined },
        pagination: pagination
          ? {
              ...state.pagination,
              [sessionId]: {
                ...(state.pagination[sessionId] || DEFAULT_PAGINATION),
                ...pagination,
                isLoadingMore: false,
              },
            }
          : state.pagination,
      };
    }),

  appendMessages: (sessionId, newMessages, pagination) =>
    set(state => {
      const currentMessages = state.messages[sessionId] || [];
      const hydratedNewMessages = hydrateMessagesForDisplay(newMessages);
      const existingMessages = adoptOptimisticUserMessages(currentMessages, hydratedNewMessages);
      // Deduplicate by message ID
      const existingIds = new Set(existingMessages.map(m => m.id));
      const deduped = hydratedNewMessages.filter(m => !existingIds.has(m.id));
      const existingPagination = state.pagination[sessionId] || DEFAULT_PAGINATION;
      const nextMessageVersion =
        pagination?.messageVersion != null
          ? Math.max(pagination.messageVersion, existingPagination.messageVersion ?? 0)
          : existingPagination.messageVersion;
      if (
        deduped.length === 0 &&
        existingMessages === currentMessages &&
        nextMessageVersion === existingPagination.messageVersion
      ) {
        return state;
      }

      const combined = [...existingMessages, ...deduped];

      return {
        messages: { ...state.messages, [sessionId]: combined },
        pagination: {
          ...state.pagination,
          [sessionId]: {
            ...existingPagination,
            // Only update forward-direction fields; preserve hasMore/oldestTimestamp
            // (those are for the "load older" direction and must not be overwritten
            // by gap-fill or sync responses)
            total: pagination?.total ?? existingPagination.total,
            newestTimestamp: pagination?.newestTimestamp ?? existingPagination.newestTimestamp,
            maxOffset:
              pagination?.maxOffset != null
                ? Math.max(pagination.maxOffset, existingPagination.maxOffset ?? 0)
                : existingPagination.maxOffset,
            messageVersion: nextMessageVersion,
            isLoadingMore: false,
          },
        },
      };
    }),

  mergeMessages: (sessionId, incomingMessages, pagination) =>
    set(state => {
      const currentMessages = state.messages[sessionId] || [];
      const hydratedIncomingMessages = hydrateMessagesForDisplay(incomingMessages);
      const existingMessages = adoptOptimisticUserMessages(
        currentMessages,
        hydratedIncomingMessages
      );
      const byId = new Map(existingMessages.map(message => [message.id, message]));
      let changed = existingMessages !== currentMessages;

      for (const incoming of hydratedIncomingMessages) {
        const existing = byId.get(incoming.id);
        if (!existing) {
          byId.set(incoming.id, incoming);
          changed = true;
          continue;
        }

        const merged = withoutContentRegression(existing, { ...existing, ...incoming });
        if (JSON.stringify(existing) !== JSON.stringify(merged)) {
          byId.set(incoming.id, merged);
          changed = true;
        }
      }

      const existingPagination = state.pagination[sessionId] || DEFAULT_PAGINATION;
      const nextPagination = pagination
        ? {
            ...existingPagination,
            ...pagination,
            maxOffset:
              pagination.maxOffset != null
                ? Math.max(pagination.maxOffset, existingPagination.maxOffset ?? 0)
                : existingPagination.maxOffset,
            messageVersion:
              pagination.messageVersion != null
                ? Math.max(pagination.messageVersion, existingPagination.messageVersion ?? 0)
                : existingPagination.messageVersion,
            isLoadingMore: false,
          }
        : existingPagination;

      if (!changed && nextPagination === existingPagination) return state;

      const mergedMessages = Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt);

      return {
        messages: { ...state.messages, [sessionId]: mergedMessages },
        pagination: { ...state.pagination, [sessionId]: nextPagination },
      };
    }),

  addMessage: (sessionId, message) =>
    set(state => {
      const existingMessages = state.messages[sessionId] || [];
      const hydratedMessage = hydrateMessagesForDisplay([message])[0];
      // Dual dedup: check both server ID and client-generated message ID
      if (
        existingMessages.some(
          m =>
            m.id === hydratedMessage.id ||
            (hydratedMessage.clientMessageId &&
              m.clientMessageId &&
              m.clientMessageId === hydratedMessage.clientMessageId)
        )
      ) {
        return state;
      }
      const existingPagination = state.pagination[sessionId] || DEFAULT_PAGINATION;

      return {
        messages: {
          ...state.messages,
          [sessionId]: [...existingMessages, hydratedMessage],
        },
        pagination: {
          ...state.pagination,
          [sessionId]: {
            ...existingPagination,
            total: existingPagination.total + 1,
            newestTimestamp: hydratedMessage.createdAt,
          },
        },
      };
    }),

  // Update a message's server ID by matching its clientMessageId
  updateMessageIdByClientMessageId: (sessionId: string, clientMessageId: string, newId: string) =>
    set(state => {
      const sessionMessages = state.messages[sessionId] || [];
      const idx = sessionMessages.findIndex(m => m.clientMessageId === clientMessageId);
      if (idx === -1) return state;
      if (sessionMessages[idx].id === newId) return state;
      // A sync already brought the persisted row in (unpaired, e.g. its text
      // differs from the optimistic copy): drop the copy rather than renaming it
      // into a second message with the same id.
      const rowIdx = sessionMessages.findIndex(m => m.id === newId);
      if (rowIdx !== -1) {
        const updated = sessionMessages.filter((_, i) => i !== idx);
        updated[rowIdx > idx ? rowIdx - 1 : rowIdx] = {
          ...sessionMessages[rowIdx],
          clientMessageId,
        };
        return { messages: { ...state.messages, [sessionId]: updated } };
      }
      const updated = [...sessionMessages];
      updated[idx] = { ...updated[idx], id: newId };
      return { messages: { ...state.messages, [sessionId]: updated } };
    }),

  appendToLastMessage: (sessionId, content) =>
    set(state => {
      const sessionMessages = state.messages[sessionId] || [];
      if (sessionMessages.length === 0) return state;

      const assistantIdx = findLastAssistantMessageIndex(sessionMessages);
      if (assistantIdx === -1) return state;
      const assistantMessage = sessionMessages[assistantIdx];

      const updatedMessages = [
        ...sessionMessages.slice(0, assistantIdx),
        { ...assistantMessage, content: assistantMessage.content + content },
        ...sessionMessages.slice(assistantIdx + 1),
      ];

      return {
        messages: { ...state.messages, [sessionId]: updatedMessages },
      };
    }),

  appendToMessage: (sessionId, messageId, content) =>
    set(state => {
      const sessionMessages = state.messages[sessionId] || [];
      const messageIdx = sessionMessages.findIndex(message => message.id === messageId);
      if (messageIdx === -1) return state;
      const message = sessionMessages[messageIdx];
      const updatedMessages = [...sessionMessages];
      updatedMessages[messageIdx] = { ...message, content: message.content + content };
      return { messages: { ...state.messages, [sessionId]: updatedMessages } };
    }),

  clearMessages: sessionId =>
    set(state => ({
      messages: { ...state.messages, [sessionId]: [] },
      pagination: { ...state.pagination, [sessionId]: DEFAULT_PAGINATION },
    })),

  setLoadingMore: (sessionId, loading) =>
    set(state => ({
      pagination: {
        ...state.pagination,
        [sessionId]: {
          ...(state.pagination[sessionId] || DEFAULT_PAGINATION),
          isLoadingMore: loading,
        },
      },
    })),

  getPagination: sessionId => get().pagination[sessionId],
}));
