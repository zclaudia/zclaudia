import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSendQueueConsumer } from '../useSendQueueConsumer';
import { useSendQueueStore } from '../../../../stores/sendQueueStore';
import { useSessionRunStateStore } from '../../../../stores/sessionRunStateStore';

const SESSION = 'session-1';

function enqueue(content: string) {
  useSendQueueStore.getState().enqueue({
    sessionId: SESSION,
    content,
    attachments: [],
    intent: 'queue',
  });
}

function flushMicrotasks() {
  // Resolve the pending `void drainOne()` chains without advancing fake timers.
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useSendQueueConsumer', () => {
  beforeEach(() => {
    useSendQueueStore.setState({ queues: {} });
    useSessionRunStateStore.setState({ records: {} });
  });

  it('ships the first queued item when the session is idle on mount', async () => {
    enqueue('first');
    const sendAsNewRun = vi.fn().mockResolvedValue(undefined);

    renderHook(() => useSendQueueConsumer({ sessionId: SESSION, sendAsNewRun }));

    await waitFor(() => expect(sendAsNewRun).toHaveBeenCalledTimes(1));
    expect(sendAsNewRun).toHaveBeenCalledWith('first', []);
    // The item was popped off the queue.
    expect(useSendQueueStore.getState().queues[SESSION]).toBeUndefined();
  });

  it('leaves the queue untouched in a popped-out placeholder and resumes when brought back', async () => {
    enqueue('first');
    const sendAsNewRun = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ enabled }) => useSendQueueConsumer({ sessionId: SESSION, sendAsNewRun, enabled }),
      { initialProps: { enabled: false } }
    );
    expect(sendAsNewRun).not.toHaveBeenCalled();
    expect(useSendQueueStore.getState().queues[SESSION]).toHaveLength(1);
    rerender({ enabled: true });
    await waitFor(() => expect(sendAsNewRun).toHaveBeenCalledExactlyOnceWith('first', []));
  });

  it('releases the previous shipping lock when the mounted session changes', async () => {
    enqueue('A item');
    useSendQueueStore
      .getState()
      .enqueue({ sessionId: 'session-2', content: 'B item', attachments: [], intent: 'queue' });
    const sendAsNewRun = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ sessionId }) => useSendQueueConsumer({ sessionId, sendAsNewRun }),
      { initialProps: { sessionId: SESSION } }
    );
    await waitFor(() => expect(sendAsNewRun).toHaveBeenCalledWith('A item', []));
    rerender({ sessionId: 'session-2' });
    await waitFor(() => expect(sendAsNewRun).toHaveBeenCalledWith('B item', []));
  });

  it('recovers from a wedged lock when a shipped run never registers as active', async () => {
    vi.useFakeTimers();
    try {
      enqueue('first');
      enqueue('second');
      const sendAsNewRun = vi.fn().mockResolvedValue(undefined);

      renderHook(() => useSendQueueConsumer({ sessionId: SESSION, sendAsNewRun }));

      // Mount drain ships item 1 and holds the lock waiting for the run to go
      // active — which never happens here (simulating a silent run_start drop).
      await flushMicrotasks();
      expect(sendAsNewRun).toHaveBeenCalledTimes(1);
      expect(sendAsNewRun).toHaveBeenLastCalledWith('first', []);

      // Without the fallback the queue would wedge forever. Advancing past the
      // timeout releases the lock and re-drains the next item.
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      await flushMicrotasks();

      expect(sendAsNewRun).toHaveBeenCalledTimes(2);
      expect(sendAsNewRun).toHaveBeenLastCalledWith('second', []);
    } finally {
      vi.useRealTimers();
    }
  });
});
