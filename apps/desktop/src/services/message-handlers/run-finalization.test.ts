import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatMessageStore } from '../../stores/chatMessageStore';
import { useRunStore } from '../../stores/runStore';
import { __resetDeltaBufferForTests, scheduleDelta } from './delta-buffer';
import { finalizeRunLifecycle } from './run-finalization';

let pendingFrame: FrameRequestCallback | null;

function resetStores() {
  useChatMessageStore.setState({ messages: {}, pagination: {} });
  useRunStore.setState({
    activeRuns: {},
    assistantMessageIds: {},
    backgroundRunIds: new Set(),
    runHealth: {},
    runRetryStatus: {},
    activeToolCalls: {},
    toolCallsHistory: {},
    runContentBlocks: {},
  });
}

beforeEach(() => {
  pendingFrame = null;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pendingFrame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    pendingFrame = null;
  });
  __resetDeltaBufferForTests();
  resetStores();
});

afterEach(() => {
  __resetDeltaBufferForTests();
  vi.unstubAllGlobals();
});

describe('finalizeRunLifecycle', () => {
  it('flushes pending deltas, applies the authoritative snapshot, then discards run state', () => {
    useChatMessageStore.getState().setMessages('s1', [
      {
        id: 'm1',
        sessionId: 's1',
        role: 'assistant',
        content: '',
        createdAt: 1,
      },
    ]);
    useRunStore.getState().startRun('r1', 's1', false, 'm1');
    scheduleDelta('s1', 'r1', 'partial');

    const result = finalizeRunLifecycle('r1', {
      sessionId: 's1',
      assistantMessageId: 'm1',
      content: 'authoritative final',
      contentBlocks: [{ type: 'text', content: 'authoritative final' }],
      messageVersion: 4,
    });

    expect(result).toEqual({ sessionId: 's1', assistantMessageId: 'm1' });
    expect(useChatMessageStore.getState().messages.s1[0]).toMatchObject({
      content: 'authoritative final',
      contentBlocks: [{ type: 'text', content: 'authoritative final' }],
    });
    expect(useChatMessageStore.getState().pagination.s1.messageVersion).toBe(4);
    expect(useRunStore.getState().activeRuns.r1).toBeUndefined();

    // The already-scheduled frame is now harmless: finalization consumed its
    // pending delta exactly once.
    pendingFrame?.(0);
    expect(useChatMessageStore.getState().messages.s1[0].content).toBe('authoritative final');
  });

  it('uses buffered content when no authoritative terminal body is available', () => {
    useChatMessageStore.getState().setMessages('s1', [
      {
        id: 'm1',
        sessionId: 's1',
        role: 'assistant',
        content: '',
        createdAt: 1,
      },
    ]);
    useRunStore.getState().startRun('r1', 's1', false, 'm1');
    scheduleDelta('s1', 'r1', 'complete buffered body');

    finalizeRunLifecycle('r1');

    expect(useChatMessageStore.getState().messages.s1[0].content).toBe('complete buffered body');
    expect(useRunStore.getState().activeRuns.r1).toBeUndefined();
  });

  it('is safe when the same terminal snapshot is replayed after tracking was removed', () => {
    useChatMessageStore.getState().setMessages('s1', [
      {
        id: 'm1',
        sessionId: 's1',
        role: 'assistant',
        content: 'partial',
        createdAt: 1,
      },
    ]);
    useRunStore.getState().startRun('r1', 's1', false, 'm1');
    const final = {
      sessionId: 's1',
      assistantMessageId: 'm1',
      content: 'final',
      messageVersion: 7,
    };

    finalizeRunLifecycle('r1', final);
    finalizeRunLifecycle('r1', final);

    expect(useChatMessageStore.getState().messages.s1[0].content).toBe('final');
    expect(useChatMessageStore.getState().pagination.s1.messageVersion).toBe(7);
  });

  it('accepts a late authoritative snapshot after heartbeat reconciliation already ended the run', () => {
    useChatMessageStore.getState().setMessages('s1', [
      {
        id: 'm1',
        sessionId: 's1',
        role: 'assistant',
        content: 'partial',
        createdAt: 1,
      },
    ]);
    useRunStore.getState().startRun('r1', 's1', false, 'm1');

    // Reconciliation has no final body, so it preserves the local partial
    // content while releasing run-local state.
    finalizeRunLifecycle('r1');
    expect(useRunStore.getState().activeRuns.r1).toBeUndefined();

    // The terminal event can arrive later. Explicit message identity makes the
    // update safe even though tracking no longer exists.
    finalizeRunLifecycle('r1', {
      sessionId: 's1',
      assistantMessageId: 'm1',
      content: 'full authoritative body',
      contentBlocks: [{ type: 'text', content: 'full authoritative body' }],
      messageVersion: 9,
    });

    expect(useChatMessageStore.getState().messages.s1[0]).toMatchObject({
      content: 'full authoritative body',
      contentBlocks: [{ type: 'text', content: 'full authoritative body' }],
    });
    expect(useChatMessageStore.getState().pagination.s1.messageVersion).toBe(9);
  });

  it('produces the same display body live and after persisted-message hydration', () => {
    useChatMessageStore.getState().setMessages('s1', [
      {
        id: 'm1',
        sessionId: 's1',
        role: 'assistant',
        content: 'partial',
        createdAt: 1,
      },
    ]);
    useRunStore.getState().startRun('r1', 's1', false, 'm1');
    finalizeRunLifecycle('r1', {
      sessionId: 's1',
      assistantMessageId: 'm1',
      content: 'complete body',
      contentBlocks: [
        { type: 'tool_use', toolUseId: 't1' },
        { type: 'text', content: 'complete body' },
      ],
    });
    const live = useChatMessageStore.getState().messages.s1[0];

    useChatMessageStore.setState({ messages: {}, pagination: {} });
    useChatMessageStore.getState().setMessages('s1', [
      {
        id: 'm1',
        sessionId: 's1',
        role: 'assistant',
        content: 'complete body',
        createdAt: 1,
        metadata: {
          contentBlocks: [
            { type: 'tool_use', toolUseId: 't1' },
            { type: 'text', content: 'complete body' },
          ],
        },
      },
    ]);
    const reloaded = useChatMessageStore.getState().messages.s1[0];

    expect({
      content: reloaded.content,
      contentBlocks: reloaded.contentBlocks,
    }).toEqual({
      content: live.content,
      contentBlocks: live.contentBlocks,
    });
  });
});
