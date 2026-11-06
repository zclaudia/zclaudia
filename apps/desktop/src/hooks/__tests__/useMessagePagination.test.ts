// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { createElement, StrictMode } from 'react';
import { useMessagePagination } from '../../features/chat/hooks/useMessagePagination';
import { useRunStore } from '../../stores/runStore';
import { useChatMessageStore } from '../../stores/chatMessageStore';
import { useSessionConfigStore } from '../../stores/sessionConfigStore';
import { useUIStore } from '../../stores/uiStore';
import { useFilePushStore } from '../../stores/filePushStore';

vi.mock('../../services/api', () => ({
  getSessionMessages: vi.fn(),
}));

import * as api from '../../services/api';

describe('useMessagePagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRunStore.setState({
      activeRuns: {},
      backgroundRunIds: new Set(),
      runHealth: {},
      activeToolCalls: {},
      toolCallsHistory: {},
      runContentBlocks: {},
    });
    useChatMessageStore.setState({
      messages: {},
      pagination: {},
    });
    useSessionConfigStore.setState({
      systemInfoBySession: {},
      modeBySession: {},
      runtimeModes: {},
      sessionUsage: {},
      compactionNotice: {},
    });
    useUIStore.setState({
      forceScrollToBottomSessionId: null,
      pendingMessageJump: null,
      poppedOutSessions: new Map(),
    });
    useFilePushStore.setState({ items: [] });
  });

  afterEach(() => vi.unstubAllGlobals());

  async function mountScrollable() {
    vi.mocked(api.getSessionMessages).mockResolvedValue({
      messages: [],
      pagination: { total: 0, hasMore: false },
      activeRun: null,
    });
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const flushFrames = () =>
      act(() => {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach(callback => callback(0));
      });
    const hook = renderHook(
      ({ sessionId }) => useMessagePagination({ sessionId, isConnected: true, isMobile: true }),
      { initialProps: { sessionId: 'session-1' } }
    );
    const container = document.createElement('div');
    Object.defineProperties(container, {
      scrollHeight: { configurable: true, value: 2000, writable: true },
      clientHeight: { configurable: true, value: 500 },
    });
    container.scrollTo = vi.fn();
    (hook.result.current.messagesContainerRef as { current: HTMLDivElement | null }).current =
      container;
    await waitFor(() => expect(hook.result.current.initialLoadDone).toBe(true));
    flushFrames();
    vi.mocked(api.getSessionMessages).mockClear();
    return { ...hook, container, flushFrames };
  }

  it('does not refresh the latest tail for programmatic downward scrolls', async () => {
    const { result, container } = await mountScrollable();
    const now = vi.spyOn(Date, 'now');
    for (let index = 0; index < 4; index++) {
      now.mockReturnValue(10000 + index * 3000);
      container.scrollTop = 1500 + index;
      act(() => result.current.handleScroll());
    }
    expect(api.getSessionMessages).not.toHaveBeenCalled();
    now.mockRestore();
  });

  it('repairs a user wheel reaching bottom and wheel input against the bottom edge', async () => {
    const { result, container } = await mountScrollable();
    container.scrollTop = 1300;
    act(() => result.current.handleMessageWheel(100));
    container.scrollTop = 1500;
    act(() => result.current.handleScroll());
    await waitFor(() =>
      expect(api.getSessionMessages).toHaveBeenCalledWith('session-1', { limit: 12 })
    );

    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3000);
    act(() => result.current.handleMessageWheel(100));
    await waitFor(() => expect(api.getSessionMessages).toHaveBeenCalledTimes(2));
    now.mockRestore();
  });

  it('repairs downward touch scrolling while ignoring upward touch intent', async () => {
    const { result, container } = await mountScrollable();
    container.scrollTop = 1300;
    fireEvent.touchStart(container, { touches: [{ clientY: 300 }] });
    fireEvent.touchMove(container, { touches: [{ clientY: 200 }] });
    container.scrollTop = 1500;
    act(() => result.current.handleScroll());
    await waitFor(() => expect(api.getSessionMessages).toHaveBeenCalledTimes(1));

    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3000);
    fireEvent.touchStart(container, { touches: [{ clientY: 200 }] });
    fireEvent.touchMove(container, { touches: [{ clientY: 300 }] });
    container.scrollTop = 1501;
    act(() => result.current.handleScroll());
    expect(api.getSessionMessages).toHaveBeenCalledTimes(1);
    now.mockRestore();
  });

  it('coalesces scroll metrics to the latest position once per frame', async () => {
    const { result, container, flushFrames } = await mountScrollable();
    act(() => {
      container.scrollTop = 300;
      result.current.handleScroll();
      container.scrollTop = 700;
      result.current.handleScroll();
    });
    expect(result.current.scrollMetrics.scrollTop).toBe(0);
    flushFrames();
    expect(result.current.scrollMetrics).toEqual({ scrollTop: 700, viewportHeight: 500 });
  });

  it('does not restore a pending history request into a different session', async () => {
    const { result, container, flushFrames, rerender } = await mountScrollable();
    act(() =>
      useChatMessageStore.setState({
        pagination: {
          'session-1': { total: 100, hasMore: true, oldestTimestamp: 10, isLoadingMore: false },
        },
      })
    );
    let resolveHistory!: (value: Awaited<ReturnType<typeof api.getSessionMessages>>) => void;
    vi.mocked(api.getSessionMessages).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveHistory = resolve;
        })
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.loadMoreMessages();
    });
    rerender({ sessionId: 'session-2' });
    await waitFor(() => expect(result.current.initialLoadDone).toBe(true));
    container.scrollTop = 600;
    Object.defineProperty(container, 'scrollHeight', { value: 4000, writable: true });
    await act(async () => {
      resolveHistory({ messages: [], pagination: { total: 0, hasMore: false }, activeRun: null });
      await pending;
    });
    flushFrames();
    expect(container.scrollTop).toBe(600);
  });

  it('keeps metrics live after StrictMode replays effects', async () => {
    vi.mocked(api.getSessionMessages).mockResolvedValue({
      messages: [],
      pagination: { total: 0, hasMore: false },
      activeRun: null,
    });
    const frames = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
    const container = document.createElement('div');
    container.scrollTop = 333;
    container.scrollTo = vi.fn();
    Object.defineProperty(container, 'clientHeight', { value: 500 });
    const { result } = renderHook(
      () => {
        const pagination = useMessagePagination({
          sessionId: 'session-1',
          isConnected: true,
          isMobile: false,
        });
        (pagination.messagesContainerRef as { current: HTMLDivElement | null }).current = container;
        return pagination;
      },
      { wrapper: ({ children }) => createElement(StrictMode, null, children) }
    );
    await waitFor(() => expect(result.current.initialLoadDone).toBe(true));
    act(() => {
      result.current.handleScroll();
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback(0));
    });
    expect(result.current.scrollMetrics).toEqual({ scrollTop: 333, viewportHeight: 500 });
  });

  it('loads initial messages via HTTP even before websocket reports connected', async () => {
    vi.mocked(api.getSessionMessages).mockResolvedValue({
      messages: [
        {
          id: 'msg-1',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'hello',
          createdAt: 1,
        } as any,
      ],
      pagination: {
        total: 1,
        hasMore: false,
        maxOffset: 1,
      },
      activeRun: null,
    });

    const { result } = renderHook(
      ({ isConnected }) =>
        useMessagePagination({
          sessionId: 'session-1',
          isConnected,
          isMobile: false,
        }),
      {
        initialProps: { isConnected: false },
      }
    );

    await waitFor(() => {
      expect(api.getSessionMessages).toHaveBeenCalledWith('session-1', {
        limit: 50,
        signal: expect.any(AbortSignal),
      });
    });

    await waitFor(() => {
      expect(result.current.initialLoadDone).toBe(true);
    });

    expect(useChatMessageStore.getState().messages['session-1']).toHaveLength(1);
  });

  it('does not refetch in a loop after initial messages are stored', async () => {
    vi.mocked(api.getSessionMessages).mockResolvedValue({
      messages: [
        {
          id: 'msg-1',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'hello',
          createdAt: 1,
        } as any,
      ],
      pagination: {
        total: 1,
        hasMore: false,
        maxOffset: 1,
      },
      activeRun: null,
    });

    renderHook(() =>
      useMessagePagination({
        sessionId: 'session-1',
        isConnected: true,
        isMobile: false,
      })
    );

    await waitFor(() => {
      expect(api.getSessionMessages).toHaveBeenCalledTimes(1);
    });

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(api.getSessionMessages).toHaveBeenCalledTimes(1);
  });

  it('sets a friendly offline error when the initial fetch fails with backend offline', async () => {
    vi.mocked(api.getSessionMessages).mockRejectedValue(new Error('BACKEND_OFFLINE'));

    const { result } = renderHook(() =>
      useMessagePagination({
        sessionId: 'session-1',
        isConnected: true,
        isMobile: false,
      })
    );

    await waitFor(() => {
      expect(result.current.initialLoadDone).toBe(true);
    });

    expect(result.current.loadError).toContain('Backend is offline');
    expect(useChatMessageStore.getState().messages['session-1']).toEqual([]);
  });

  it('preserves cached messages when the initial fetch fails offline', async () => {
    vi.mocked(api.getSessionMessages).mockRejectedValue(new Error('BACKEND_OFFLINE'));
    useChatMessageStore.setState({
      ...useChatMessageStore.getState(),
      messages: {
        'session-1': [
          {
            id: 'cached-1',
            sessionId: 'session-1',
            role: 'assistant',
            content: 'cached message',
            createdAt: 1,
          } as any,
        ],
      },
      pagination: {
        'session-1': {
          total: 1,
          hasMore: false,
          maxOffset: 1,
        } as any,
      },
    });

    const { result } = renderHook(() =>
      useMessagePagination({
        sessionId: 'session-1',
        isConnected: true,
        isMobile: false,
      })
    );

    await waitFor(() => {
      expect(result.current.initialLoadDone).toBe(true);
    });

    expect(result.current.loadError).toContain('Backend is offline');
    expect(useChatMessageStore.getState().messages['session-1']).toEqual([
      expect.objectContaining({ id: 'cached-1', content: 'cached message' }),
    ]);
  });

  it('uses aroundMessageId when a pending message jump targets the session', async () => {
    vi.mocked(api.getSessionMessages).mockResolvedValue({
      messages: [],
      pagination: {
        total: 0,
        hasMore: false,
      },
      activeRun: null,
    });
    useUIStore.setState({
      ...useUIStore.getState(),
      pendingMessageJump: {
        sessionId: 'session-1',
        messageId: 'msg-42',
      },
    });

    renderHook(() =>
      useMessagePagination({
        sessionId: 'session-1',
        isConnected: true,
        isMobile: false,
      })
    );

    await waitFor(() => {
      expect(api.getSessionMessages).toHaveBeenCalledWith('session-1', {
        limit: 50,
        aroundMessageId: 'msg-42',
        signal: expect.any(AbortSignal),
      });
    });
  });

  it('syncs file push metadata from loaded messages into filePushStore', async () => {
    vi.mocked(api.getSessionMessages).mockResolvedValue({
      messages: [
        {
          id: 'msg-1',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'download ready',
          createdAt: 1,
          metadata: {
            filePush: {
              fileId: 'file-1',
              fileName: 'report.txt',
              mimeType: 'text/plain',
              fileSize: 128,
              description: 'Generated report',
            },
          },
        } as any,
      ],
      pagination: {
        total: 1,
        hasMore: false,
        maxOffset: 1,
      },
      activeRun: null,
    });

    renderHook(() =>
      useMessagePagination({
        sessionId: 'session-1',
        isConnected: true,
        isMobile: false,
      })
    );

    await waitFor(() => {
      expect(useFilePushStore.getState().items).toHaveLength(1);
    });

    expect(useFilePushStore.getState().items[0]).toEqual(
      expect.objectContaining({
        fileId: 'file-1',
        fileName: 'report.txt',
        sessionId: 'session-1',
        status: 'pending',
      })
    );
  });
});
