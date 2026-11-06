import { useRef, useEffect, useCallback, useState } from 'react';
import { useRunStore } from '../../../stores/runStore';
import { useChatMessageStore, type MessageWithToolCalls } from '../../../stores/chatMessageStore';
import { useFilePushStore } from '../../../stores/filePushStore';
import { useUIStore } from '../../../stores/uiStore';
import * as api from '../../../services/api';

const MESSAGES_PER_PAGE = 50;
const BOTTOM_REFRESH_LIMIT = 12;
const BOTTOM_REFRESH_COOLDOWN_MS = 2500;
const SUPPRESS_LOAD_MORE_MS = 1200;
const USER_SCROLL_INTENT_MS = 1500;

interface UseMessagePaginationParams {
  sessionId: string;
  isConnected: boolean;
  isMobile: boolean;
}

export function useMessagePagination({
  sessionId,
  isConnected,
  isMobile,
}: UseMessagePaginationParams) {
  const pagination = useChatMessageStore(s => s.pagination);
  const setMessages = useChatMessageStore(s => s.setMessages);
  const prependMessages = useChatMessageStore(s => s.prependMessages);
  const mergeMessages = useChatMessageStore(s => s.mergeMessages);
  const setLoadingMore = useChatMessageStore(s => s.setLoadingMore);
  const sessionMessages = useChatMessageStore(s => s.messages[sessionId]);

  const forceScrollToBottomSessionId = useUIStore(s => s.forceScrollToBottomSessionId);
  const consumeForceScrollToBottom = useUIStore(s => s.consumeForceScrollToBottom);
  const pendingMessageJump = useUIStore(s => s.pendingMessageJump);
  const clearMessageJump = useUIStore(s => s.clearMessageJump);

  const sessionPagination = pagination[sessionId];

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const bottomRefreshRef = useRef<{ lastAt: number; inFlight: boolean }>({
    lastAt: 0,
    inFlight: false,
  });
  const lastScrollTopRef = useRef(0);
  const userScrollIntentUntilRef = useRef(0);
  const scrollMetricsFrameRef = useRef<number | null>(null);
  const suppressLoadMoreUntilRef = useRef<number>(0);
  const messageJumpTimeoutRef = useRef<number | null>(null);

  // State
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [scrollMetrics, setScrollMetrics] = useState({ scrollTop: 0, viewportHeight: 0 });
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const scrollToBottom = useCallback(
    (instant = false) => {
      userScrollIntentUntilRef.current = 0;
      const container = messagesContainerRef.current;
      if (container) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: instant || isMobile ? 'auto' : 'smooth',
        });
        return;
      }

      messagesEndRef.current?.scrollIntoView({ behavior: instant || isMobile ? 'auto' : 'smooth' });
    },
    [isMobile]
  );

  const jumpToBottomInstant = useCallback(() => {
    suppressLoadMoreUntilRef.current = Date.now() + SUPPRESS_LOAD_MORE_MS;
    scrollToBottom(true);
  }, [scrollToBottom]);

  const scrollToMessage = useCallback(
    (messageId: string) => {
      const escapedId =
        typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(messageId) : messageId;
      const target = document.querySelector(`[data-message-id="${escapedId}"]`);
      if (!(target instanceof HTMLElement)) return false;

      userScrollIntentUntilRef.current = 0;
      target.scrollIntoView({ block: 'center', behavior: isMobile ? 'auto' : 'smooth' });
      setHighlightedMessageId(messageId);
      window.setTimeout(() => {
        setHighlightedMessageId(current => (current === messageId ? null : current));
      }, 2500);
      return true;
    },
    [isMobile]
  );

  const positionViewportForMessageJump = useCallback(
    (messageId: string) => {
      const container = messagesContainerRef.current;
      const msgs = sessionMessages || [];
      if (!container || msgs.length === 0) return false;

      const messageIndex = msgs.findIndex(message => message.id === messageId);
      if (messageIndex === -1) return false;

      const progress = msgs.length <= 1 ? 0 : messageIndex / (msgs.length - 1);
      const targetTop = Math.max(0, container.scrollHeight * progress - container.clientHeight / 2);

      suppressLoadMoreUntilRef.current = Date.now() + SUPPRESS_LOAD_MORE_MS;
      userScrollIntentUntilRef.current = 0;
      container.scrollTo({ top: targetTop, behavior: 'auto' });
      return true;
    },
    [sessionMessages]
  );

  // Sync filePush metadata from loaded messages into filePushStore for download tracking
  const syncFilePushMessages = useCallback((msgs: MessageWithToolCalls[]) => {
    const fpStore = useFilePushStore.getState();
    for (const msg of msgs) {
      if (msg.metadata?.filePush) {
        const fp = msg.metadata.filePush;
        fpStore.addItem({
          fileId: fp.fileId,
          fileName: fp.fileName,
          mimeType: fp.mimeType,
          fileSize: fp.fileSize,
          sessionId: msg.sessionId,
          description: fp.description,
          autoDownload: false,
        });
      }
    }
  }, []);

  // Load messages with pagination (all via HTTP)
  const loadMessages = useCallback(
    async (before?: number, signal?: AbortSignal) => {
      try {
        if (before) {
          // Load more (older messages)
          setLoadingMore(sessionId, true);

          const result = await api.getSessionMessages(sessionId, {
            limit: MESSAGES_PER_PAGE,
            before,
            signal,
          });

          prependMessages(sessionId, result.messages, result.pagination);
          syncFilePushMessages(result.messages);
        } else {
          // Initial load via HTTP
          setLoadError(null);
          const result = await api.getSessionMessages(
            sessionId,
            pendingMessageJump?.sessionId === sessionId
              ? { limit: MESSAGES_PER_PAGE, aroundMessageId: pendingMessageJump.messageId, signal }
              : { limit: MESSAGES_PER_PAGE, signal }
          );

          setMessages(sessionId, result.messages, result.pagination);
          syncFilePushMessages(result.messages);

          // Restore active run state (fixes loading state lost after page refresh)
          if (result.activeRun) {
            const chatState = useRunStore.getState();
            if (!chatState.activeRuns[result.activeRun.runId]) {
              chatState.startRun(result.activeRun.runId, sessionId);
            }
          }

          setInitialLoadDone(true);
          // Use rAF to ensure the DOM has rendered the new messages before scrolling
          requestAnimationFrame(() => {
            if (pendingMessageJump?.sessionId === sessionId) {
              return;
            }
            scrollToBottom(true);
          });
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        console.error('Failed to load messages:', error);
        setLoadingMore(sessionId, false);
        if (!before) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          const isTimeout =
            errMsg.includes('timed out') ||
            errMsg.includes('timeout') ||
            errMsg.includes('TIMEOUT');
          const isOffline =
            errMsg.includes('BACKEND_OFFLINE') ||
            errMsg.includes('502') ||
            errMsg.includes('Failed to fetch');
          const friendlyMsg = isOffline
            ? 'Backend is offline. This session may belong to a server that is currently unreachable.'
            : isTimeout
              ? 'Request timed out. The backend server may be unresponsive.'
              : `Failed to load messages: ${errMsg}`;
          setLoadError(friendlyMsg);
          // Preserve previously loaded messages so offline session re-open still shows cached history.
          const existingMessages = useChatMessageStore.getState().messages[sessionId];
          if (!existingMessages || existingMessages.length === 0) {
            setMessages(sessionId, [], { total: 0, hasMore: false });
          }
          setInitialLoadDone(true);
        }
      }
    },
    [
      sessionId,
      setLoadingMore,
      prependMessages,
      setMessages,
      scrollToBottom,
      syncFilePushMessages,
      pendingMessageJump,
    ]
  );

  // Load initial messages when session changes
  useEffect(() => {
    setInitialLoadDone(false);
    const controller = new AbortController();
    loadMessages(undefined, controller.signal);
    return () => controller.abort();
  }, [sessionId, loadMessages]);

  // Message jump effect
  useEffect(() => {
    if (pendingMessageJump?.sessionId !== sessionId) return;
    if (!initialLoadDone) return;

    const { messageId } = pendingMessageJump;
    if (messageJumpTimeoutRef.current != null) {
      window.clearTimeout(messageJumpTimeoutRef.current);
      messageJumpTimeoutRef.current = null;
    }

    let cancelled = false;
    let attempts = 0;

    const tryJump = () => {
      if (cancelled) return;
      if (scrollToMessage(messageId)) {
        clearMessageJump(sessionId, messageId);
        messageJumpTimeoutRef.current = null;
        return;
      }

      if (attempts === 0) {
        positionViewportForMessageJump(messageId);
      }

      attempts += 1;
      if (attempts >= 4) {
        clearMessageJump(sessionId, messageId);
        messageJumpTimeoutRef.current = null;
        return;
      }

      messageJumpTimeoutRef.current = window.setTimeout(tryJump, 80);
    };

    tryJump();

    return () => {
      cancelled = true;
      if (messageJumpTimeoutRef.current != null) {
        window.clearTimeout(messageJumpTimeoutRef.current);
        messageJumpTimeoutRef.current = null;
      }
    };
  }, [
    pendingMessageJump,
    sessionId,
    initialLoadDone,
    clearMessageJump,
    scrollToMessage,
    positionViewportForMessageJump,
  ]);

  // One-shot jump: when entering from Active Sessions, force scroll to latest content
  useEffect(() => {
    if (forceScrollToBottomSessionId !== sessionId || !initialLoadDone) return;
    scrollToBottom(true);
    const timer = setTimeout(() => scrollToBottom(true), 120);
    consumeForceScrollToBottom(sessionId);
    return () => clearTimeout(timer);
  }, [
    forceScrollToBottomSessionId,
    sessionId,
    initialLoadDone,
    scrollToBottom,
    consumeForceScrollToBottom,
  ]);

  // Load more messages (older)
  const loadMoreMessages = useCallback(async () => {
    if (!sessionPagination?.hasMore || sessionPagination?.isLoadingMore) {
      console.debug(
        `[ChatInterface] loadMoreMessages skipped: hasMore=${sessionPagination?.hasMore}, isLoadingMore=${sessionPagination?.isLoadingMore}`
      );
      return;
    }

    const oldestTimestamp = sessionPagination?.oldestTimestamp;
    if (!oldestTimestamp) {
      console.debug('[ChatInterface] loadMoreMessages skipped: no oldestTimestamp');
      return;
    }
    console.debug(`[ChatInterface] loadMoreMessages: loading before=${oldestTimestamp}`);

    // The message list preserves its visible DOM anchor when history commits.
    // Total scrollHeight deltas include unrelated streaming growth at the tail.
    await loadMessages(oldestTimestamp);
  }, [loadMessages, sessionPagination]);

  // Fallback sync: fetch latest when user is at bottom
  const refreshLatestMessagesFromBottom = useCallback(async () => {
    if (!isConnected || !initialLoadDone) return;
    const state = bottomRefreshRef.current;
    const now = Date.now();
    if (state.inFlight || now - state.lastAt < BOTTOM_REFRESH_COOLDOWN_MS) return;

    state.inFlight = true;
    state.lastAt = now;
    try {
      const result = await api.getSessionMessages(sessionId, { limit: BOTTOM_REFRESH_LIMIT });
      // This is a latest-tail snapshot, not an insert-only page. Merge by id so
      // an updated final assistant row repairs the live view as well.
      mergeMessages(sessionId, result.messages, result.pagination);
      syncFilePushMessages(result.messages);
    } catch (error) {
      console.debug('[ChatInterface] bottom refresh failed:', error);
    } finally {
      state.inFlight = false;
    }
  }, [initialLoadDone, isConnected, mergeMessages, sessionId, syncFilePushMessages]);

  const handleMessageWheel = useCallback(
    (deltaY: number) => {
      if (deltaY <= 0) {
        userScrollIntentUntilRef.current = 0;
        return;
      }
      userScrollIntentUntilRef.current = Date.now() + USER_SCROLL_INTENT_MS;
      const container = messagesContainerRef.current;
      if (!container) return;

      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distanceFromBottom <= 24) {
        userScrollIntentUntilRef.current = 0;
        void refreshLatestMessagesFromBottom();
      }
    },
    [refreshLatestMessagesFromBottom]
  );

  // Touch scrolls (including momentum) need the same repair path as wheel
  // input, but plain scroll events also come from streaming auto-follow.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    let lastTouchY: number | null = null;
    const onTouchStart = (event: TouchEvent) => {
      lastTouchY = event.touches[0]?.clientY ?? null;
      userScrollIntentUntilRef.current = 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY;
      if (nextY == null || lastTouchY == null) return;
      handleMessageWheel(lastTouchY - nextY);
      lastTouchY = nextY;
    };
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
    };
  }, [sessionId, initialLoadDone, handleMessageWheel]);

  const scheduleScrollMetrics = useCallback(() => {
    if (scrollMetricsFrameRef.current != null) return;
    scrollMetricsFrameRef.current = requestAnimationFrame(() => {
      scrollMetricsFrameRef.current = null;
      const container = messagesContainerRef.current;
      if (!container) return;
      const scrollTop = container.scrollTop;
      const viewportHeight = container.clientHeight;
      setScrollMetrics(previous =>
        previous.scrollTop === scrollTop && previous.viewportHeight === viewportHeight
          ? previous
          : { scrollTop, viewportHeight }
      );
    });
  }, []);

  useEffect(
    () => () => {
      if (scrollMetricsFrameRef.current != null) {
        cancelAnimationFrame(scrollMetricsFrameRef.current);
        scrollMetricsFrameRef.current = null;
      }
    },
    [sessionId]
  );

  // Handle scroll to detect when user scrolls near top or away from bottom
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const currentScrollTop = container.scrollTop;
    const wasScrollingDown = currentScrollTop > lastScrollTopRef.current;
    lastScrollTopRef.current = currentScrollTop;

    scheduleScrollMetrics();

    // If scrolled near top (within 100px), load more messages
    const suppressLoadMore = Date.now() < suppressLoadMoreUntilRef.current;
    if (
      !suppressLoadMore &&
      currentScrollTop < 100 &&
      sessionPagination?.hasMore &&
      !sessionPagination?.isLoadingMore
    ) {
      loadMoreMessages();
    }

    // Show scroll-to-bottom button when not near the bottom
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollToBottom(distanceFromBottom > 300);
    if (
      wasScrollingDown &&
      distanceFromBottom <= 24 &&
      Date.now() < userScrollIntentUntilRef.current
    ) {
      userScrollIntentUntilRef.current = 0;
      void refreshLatestMessagesFromBottom();
    }
  }, [loadMoreMessages, refreshLatestMessagesFromBottom, scheduleScrollMetrics, sessionPagination]);

  // Scroll metrics resize listener
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    scheduleScrollMetrics();
    window.addEventListener('resize', scheduleScrollMetrics);
    return () => window.removeEventListener('resize', scheduleScrollMetrics);
  }, [sessionId, initialLoadDone, scheduleScrollMetrics]);

  // Retry initial load (e.g., after error)
  const retryLoad = useCallback(() => {
    setLoadError(null);
    setInitialLoadDone(false);
    loadMessages();
  }, [loadMessages]);

  // Reset refs when session changes
  const resetRefs = useCallback(() => {
    bottomRefreshRef.current = { lastAt: 0, inFlight: false };
    lastScrollTopRef.current = 0;
    userScrollIntentUntilRef.current = 0;
    if (scrollMetricsFrameRef.current != null) {
      cancelAnimationFrame(scrollMetricsFrameRef.current);
      scrollMetricsFrameRef.current = null;
    }
    if (messageJumpTimeoutRef.current != null) {
      window.clearTimeout(messageJumpTimeoutRef.current);
      messageJumpTimeoutRef.current = null;
    }
    setScrollMetrics({ scrollTop: 0, viewportHeight: 0 });
    setLoadError(null);
  }, []);

  return {
    // Refs (for JSX binding)
    messagesEndRef,
    messagesContainerRef,
    // State
    initialLoadDone,
    showScrollToBottom,
    scrollMetrics,
    highlightedMessageId,
    loadError,
    setLoadError,
    sessionPagination,
    // Actions
    scrollToBottom,
    jumpToBottomInstant,
    scrollToMessage,
    loadMoreMessages,
    handleScroll,
    handleMessageWheel,
    retryLoad,
    resetRefs,
  };
}
