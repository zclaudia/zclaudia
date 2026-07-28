import { create } from 'zustand';
import type { Message, ContentBlock } from '@zclaudia/shared';
import type { ToolCallState } from './runStore';
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
      const existingMessages = state.messages[sessionId] || [];
      const hydratedNewMessages = hydrateMessagesForDisplay(newMessages);
      // Deduplicate by message ID
      const existingIds = new Set(existingMessages.map(m => m.id));
      const deduped = hydratedNewMessages.filter(m => !existingIds.has(m.id));
      const existingPagination = state.pagination[sessionId] || DEFAULT_PAGINATION;
      const nextMessageVersion =
        pagination?.messageVersion != null
          ? Math.max(pagination.messageVersion, existingPagination.messageVersion ?? 0)
          : existingPagination.messageVersion;
      if (deduped.length === 0 && nextMessageVersion === existingPagination.messageVersion) {
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
      const existingMessages = state.messages[sessionId] || [];
      const hydratedIncomingMessages = hydrateMessagesForDisplay(incomingMessages);
      const byId = new Map(existingMessages.map(message => [message.id, message]));
      let changed = false;

      for (const incoming of hydratedIncomingMessages) {
        const existing = byId.get(incoming.id);
        if (!existing) {
          byId.set(incoming.id, incoming);
          changed = true;
          continue;
        }

        const merged = { ...existing, ...incoming };
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
