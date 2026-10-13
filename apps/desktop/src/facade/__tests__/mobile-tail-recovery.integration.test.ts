import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverCurrentSessionTail } from '../../services/sessionSync';
import { useChatMessageStore } from '../../stores/chatMessageStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useServerStore } from '../../stores/serverStore';
import { useFacadeStore } from '../../stores/facadeStore';

const { getSessionMessages } = vi.hoisted(() => ({ getSessionMessages: vi.fn() }));
vi.mock('../../services/api', () => ({ getSessionMessages }));

const message = (content: string) => ({
  id: 'assistant-1',
  sessionId: 'session-1',
  role: 'assistant' as const,
  offset: 12,
  createdAt: 1,
  content,
  metadata: { contentBlocks: [{ type: 'text' as const, content }] },
});

describe('mobile recovery hydrates the actual rendered message store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getSessionMessages.mockReset();
    useSelectionStore.setState({ selectedSessionId: 'session-1' });
    useServerStore.setState({ activeServerId: 'backend-1' });
    useFacadeStore.setState({ reconnectGeneration: 1 });
    useChatMessageStore.setState({ messages: {}, pagination: {} });
    useChatMessageStore.getState().setMessages('session-1', [message('partial')], {
      total: 1,
      hasMore: false,
      maxOffset: 12,
      messageVersion: 1,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('replaces a partial body and rendered blocks even when the offset has not changed', async () => {
    getSessionMessages.mockResolvedValue({
      messages: [message('partial response completed while the phone was frozen')],
      pagination: { maxOffset: 12, messageVersion: 2 },
    });
    expect(await recoverCurrentSessionTail('backend-1')).toBe(true);
    const state = useChatMessageStore.getState();
    expect(state.messages['session-1']).toHaveLength(1);
    expect(state.messages['session-1'][0].content).toBe(
      'partial response completed while the phone was frozen'
    );
    expect(state.messages['session-1'][0].contentBlocks).toEqual([
      { type: 'text', content: 'partial response completed while the phone was frozen' },
    ]);
    expect(state.pagination['session-1'].maxOffset).toBe(12);
    expect(state.pagination['session-1'].messageVersion).toBe(2);
  });

  it('starts fresh recovery after reconnect and ignores a longer stale response', async () => {
    let resolveObsolete!: (value: unknown) => void;
    getSessionMessages.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveObsolete = resolve;
        })
    );
    const obsolete = recoverCurrentSessionTail('backend-1');
    useFacadeStore.setState({ reconnectGeneration: 2 });
    getSessionMessages.mockResolvedValueOnce({
      messages: [message('current complete answer')],
      pagination: { maxOffset: 12, messageVersion: 3 },
    });
    expect(await recoverCurrentSessionTail('backend-1')).toBe(true);
    resolveObsolete({
      messages: [
        message('obsolete answer that is longer and would otherwise win the no-shrink merge'),
      ],
      pagination: { maxOffset: 12, messageVersion: 2 },
    });
    expect(await obsolete).toBe(false);
    expect(useChatMessageStore.getState().messages['session-1'][0].content).toBe(
      'current complete answer'
    );
    expect(useChatMessageStore.getState().pagination['session-1'].messageVersion).toBe(3);
  });

  it('releases a hung request so later recovery can repair the store', async () => {
    getSessionMessages.mockImplementationOnce(() => new Promise(() => {}));
    const hung = recoverCurrentSessionTail('backend-1');
    await vi.advanceTimersByTimeAsync(8_001);
    expect(await hung).toBe(false);
    expect(getSessionMessages.mock.calls[0][1].signal.aborted).toBe(true);
    getSessionMessages.mockResolvedValueOnce({
      messages: [message('recovered after a timeout')],
      pagination: { maxOffset: 12, messageVersion: 2 },
    });
    expect(await recoverCurrentSessionTail('backend-1')).toBe(true);
    expect(useChatMessageStore.getState().messages['session-1'][0].content).toBe(
      'recovered after a timeout'
    );
  });
});
