import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSendMessage } from '../useSendMessage';
import type { MessageWithToolCalls } from '../../../../stores/chatMessageStore';

const SESSION = 'session-1';

const USER_MESSAGE: MessageWithToolCalls = {
  id: 'msg-1',
  sessionId: SESSION,
  role: 'user',
  content: JSON.stringify({ text: 'hello' }),
  createdAt: Date.now(),
} as MessageWithToolCalls;

function setup(overrides: Partial<Parameters<typeof useSendMessage>[0]> = {}) {
  const wsSendMessage = vi.fn();
  const props: Parameters<typeof useSendMessage>[0] = {
    sessionId: SESSION,
    isConnected: true,
    isLoading: false,
    sessionRunId: null,
    isSessionRunning: false,
    lastSessionMessage: USER_MESSAGE,
    mode: '',
    permissionOverride: null,
    currentSession: {},
    addMessage: vi.fn(),
    scrollToBottom: vi.fn(),
    wsSendMessage,
    ...overrides,
  };
  const view = renderHook((p: Parameters<typeof useSendMessage>[0]) => useSendMessage(p), {
    initialProps: props,
  });
  return { ...view, props, wsSendMessage };
}

describe('useSendMessage resend target', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('offers resend when the trailing user message sits in an idle session', () => {
    const { result } = setup();
    expect(result.current.resendTargetMessage?.id).toBe('msg-1');
  });

  it('suppresses resend between dispatching run_start and the run going active', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.sendAsNewRun('hello');
    });

    expect(result.current.resendTargetMessage).toBeNull();
  });

  it('keeps resend suppressed once the run registers as active', async () => {
    const { result, rerender, props } = setup();

    await act(async () => {
      await result.current.sendAsNewRun('hello');
    });
    rerender({ ...props, isSessionRunning: true });

    expect(result.current.resendTargetMessage).toBeNull();

    // The grace timer was cancelled, so going idle again restores the escape
    // hatch immediately rather than after another full grace window.
    rerender({ ...props, isSessionRunning: false });
    expect(result.current.resendTargetMessage?.id).toBe('msg-1');
  });

  it('raises awaitingRunStart across the dispatch gap so the thinking indicator stays up', async () => {
    const { result, rerender, props } = setup();
    expect(result.current.awaitingRunStart).toBe(false);

    await act(async () => {
      await result.current.sendAsNewRun('hello');
    });
    expect(result.current.awaitingRunStart).toBe(true);

    // Once the run is genuinely active, isLoading takes over.
    rerender({ ...props, isSessionRunning: true });
    expect(result.current.awaitingRunStart).toBe(false);
  });

  it('restores resend when a dispatched run never registers as active', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.sendAsNewRun('hello');
    });
    expect(result.current.resendTargetMessage).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(result.current.resendTargetMessage?.id).toBe('msg-1');
  });
});
