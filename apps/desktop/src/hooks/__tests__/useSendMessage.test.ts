import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { reconcileStaleLoadingRun, useSendMessage } from '../chat/useSendMessage';
import { useInteractionStore } from '../../stores/interactionStore';
import { useSendQueueStore } from '../../stores/sendQueueStore';
import * as api from '../../services/api';

vi.mock('../../services/api', () => ({
  getSessionRunState: vi.fn().mockResolvedValue({ isRunning: false }),
}));

type HookProps = Parameters<typeof useSendMessage>[0];

function makeHookProps(overrides: Partial<HookProps> = {}): HookProps {
  return {
    sessionId: 'session-1',
    isConnected: true,
    isLoading: false,
    sessionRunId: null,
    isSessionRunning: false,
    lastSessionMessage: null,
    mode: '',
    permissionOverride: null,
    currentSession: undefined,
    addMessage: vi.fn(),
    scrollToBottom: vi.fn(),
    wsSendMessage: vi.fn(),
    ...overrides,
  };
}

describe('reconcileStaleLoadingRun', () => {
  it('clears stale local run state when backend reports the session is idle', async () => {
    const clearLocalRun = vi.fn();
    const clearSessionActive = vi.fn();

    const recovered = await reconcileStaleLoadingRun({
      sessionId: 'session-1',
      sessionRunId: 'run-1',
      isLoading: true,
      getSessionRunState: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        isRunning: false,
      }),
      clearLocalRun,
      clearSessionActive,
    });

    expect(recovered).toBe(true);
    expect(clearLocalRun).toHaveBeenCalledWith('run-1');
    expect(clearSessionActive).toHaveBeenCalledWith('session-1');
  });

  it('does nothing when the backend still reports the session as running', async () => {
    const clearLocalRun = vi.fn();
    const clearSessionActive = vi.fn();

    const recovered = await reconcileStaleLoadingRun({
      sessionId: 'session-1',
      sessionRunId: 'run-1',
      isLoading: true,
      getSessionRunState: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        isRunning: true,
        activeRunId: 'run-2',
      }),
      clearLocalRun,
      clearSessionActive,
    });

    expect(recovered).toBe(false);
    expect(clearLocalRun).not.toHaveBeenCalled();
    expect(clearSessionActive).not.toHaveBeenCalled();
  });

  it('does nothing when there is no active local run to reconcile', async () => {
    const clearLocalRun = vi.fn();
    const clearSessionActive = vi.fn();
    const getSessionRunState = vi.fn();

    const recovered = await reconcileStaleLoadingRun({
      sessionId: 'session-1',
      sessionRunId: null,
      isLoading: true,
      getSessionRunState,
      clearLocalRun,
      clearSessionActive,
    });

    expect(recovered).toBe(false);
    expect(getSessionRunState).not.toHaveBeenCalled();
    expect(clearLocalRun).not.toHaveBeenCalled();
    expect(clearSessionActive).not.toHaveBeenCalled();
  });
});

describe('useSendMessage', () => {
  it('clears client-synth plan reviews after a normal message starts a run successfully', async () => {
    useInteractionStore.setState({
      interactions: {
        'plan-1': {
          type: 'interaction_plan_review',
          interactionId: 'plan-1',
          sessionId: 'session-1',
          source: 'client_synth',
          createdAt: 1,
          plan: 'Review this plan',
        },
      },
    });

    const wsSendMessage = vi.fn();
    const addMessage = vi.fn();
    const scrollToBottom = vi.fn();
    const { result } = renderHook(() =>
      useSendMessage(
        makeHookProps({
          wsSendMessage,
          addMessage,
          scrollToBottom,
        })
      )
    );

    await act(async () => {
      await result.current.handleSendMessage('execute the plan');
    });

    expect(wsSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run_start',
        sessionId: 'session-1',
      })
    );
    expect(useInteractionStore.getState().interactions).not.toHaveProperty('plan-1');
  });
});

describe('handleSendMessage — mid-run queueing', () => {
  beforeEach(() => {
    useSendQueueStore.setState({ queues: {} });
  });

  it('enqueues the message when isLoading (instead of sending run_steer)', async () => {
    const wsSendMessage = vi.fn();
    const { result } = renderHook(() =>
      useSendMessage(
        makeHookProps({
          isLoading: true,
          sessionRunId: 'r1',
          isSessionRunning: true,
          wsSendMessage,
        })
      )
    );

    await act(async () => {
      await result.current.handleSendMessage('  also fix typo  ');
    });

    // No WS message is sent — the item is staged in the send queue.
    expect(wsSendMessage).not.toHaveBeenCalled();
    const items = useSendQueueStore.getState().queues['session-1'];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sessionId: 'session-1',
      content: 'also fix typo',
      intent: 'queue',
    });
  });

  it('enqueues with attachments when isLoading + attachments present (allowed now)', async () => {
    const wsSendMessage = vi.fn();
    const { result } = renderHook(() =>
      useSendMessage(
        makeHookProps({
          isLoading: true,
          sessionRunId: 'r1',
          isSessionRunning: true,
          wsSendMessage,
        })
      )
    );

    await act(async () => {
      await result.current.handleSendMessage('hi', [
        {
          id: 'a',
          type: 'image',
          name: 'a.png',
          data: 'data:image/png;base64,',
          mimeType: 'image/png',
        },
      ]);
    });

    expect(wsSendMessage).not.toHaveBeenCalled();
    const items = useSendQueueStore.getState().queues['session-1'];
    expect(items).toHaveLength(1);
    expect(items[0].attachments).toHaveLength(1);
  });

  it('steerNow sends run_steer immediately for a given content', async () => {
    const wsSendMessage = vi.fn();
    const { result } = renderHook(() =>
      useSendMessage(
        makeHookProps({
          isLoading: true,
          sessionRunId: 'r1',
          isSessionRunning: true,
          wsSendMessage,
        })
      )
    );

    let returned: boolean | undefined;
    await act(async () => {
      returned = result.current.steerNow('  inject this  ');
    });

    expect(returned).toBe(true);
    expect(wsSendMessage).toHaveBeenCalledTimes(1);
    expect(wsSendMessage).toHaveBeenCalledWith({
      type: 'run_steer',
      runId: 'r1',
      content: 'inject this',
    });
  });

  it('steerNow is a no-op and returns false without an active sessionRunId', async () => {
    const wsSendMessage = vi.fn();
    const { result } = renderHook(() =>
      useSendMessage(
        makeHookProps({
          isLoading: true,
          sessionRunId: null,
          isSessionRunning: true,
          wsSendMessage,
        })
      )
    );

    let returned: boolean | undefined;
    await act(async () => {
      returned = result.current.steerNow('x');
    });

    // False so the caller keeps the item queued instead of dropping it.
    expect(returned).toBe(false);
    expect(wsSendMessage).not.toHaveBeenCalled();
  });

  it('skips enqueue when isLoading but content is whitespace-only and no attachments', async () => {
    const wsSendMessage = vi.fn();
    const { result } = renderHook(() =>
      useSendMessage(
        makeHookProps({
          isLoading: true,
          sessionRunId: 'r1',
          isSessionRunning: true,
          wsSendMessage,
        })
      )
    );

    await act(async () => {
      await result.current.handleSendMessage('   ');
    });

    expect(wsSendMessage).not.toHaveBeenCalled();
    expect(useSendQueueStore.getState().queues['session-1']).toBeUndefined();
  });
});

describe('handleResendLastMessage', () => {
  beforeEach(() => {
    vi.mocked(api.getSessionRunState).mockResolvedValue({ isRunning: false } as never);
  });

  it('re-runs the trailing user message without adding a duplicate optimistic copy', async () => {
    const wsSendMessage = vi.fn();
    const addMessage = vi.fn();
    const { result } = renderHook(() =>
      useSendMessage(
        makeHookProps({
          isLoading: false,
          isSessionRunning: false,
          sessionRunId: null,
          lastSessionMessage: {
            id: 'm1',
            sessionId: 'session-1',
            role: 'user',
            content: 'redo this',
            createdAt: 1,
          } as never,
          wsSendMessage,
          addMessage,
        })
      )
    );

    await act(async () => {
      await result.current.handleResendLastMessage();
    });

    // Kicks off a resend run...
    expect(wsSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run_start',
        resend: true,
        sessionId: 'session-1',
      })
    );
    // ...but does NOT re-add the already-rendered user message (would duplicate
    // it in the view and then vanish on history sync since resend isn't persisted).
    expect(addMessage).not.toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ role: 'user' })
    );
  });
});
