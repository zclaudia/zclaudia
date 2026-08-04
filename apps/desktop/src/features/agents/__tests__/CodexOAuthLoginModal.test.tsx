import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen, fireEvent } from '@testing-library/react';

const { mockStart, mockPoll, mockCancel } = vi.hoisted(() => ({
  mockStart: vi.fn(),
  mockPoll: vi.fn(),
  mockCancel: vi.fn(),
}));

vi.mock('../../../services/api', () => ({
  startCodexOAuthForBackend: mockStart,
  pollCodexOAuthStatusForBackend: mockPoll,
  cancelCodexOAuthForBackend: mockCancel,
}));

import { CodexOAuthLoginModal } from '../CodexOAuthLoginModal';

const POLL_INTERVAL_MS = 2000;

function deviceCodeSession() {
  return {
    sessionId: 's1',
    method: 'device_code' as const,
    userCode: 'ABCD-EFGH',
    verificationUri: 'https://example.com/device',
    expiresAt: Date.now() + 600_000,
  };
}

function renderModal(onSuccess = vi.fn(), onClose = vi.fn()) {
  const view = render(
    <CodexOAuthLoginModal
      backendId="b1"
      profileId="p1"
      method="device_code"
      isTauri={false}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
  return { view, onSuccess, onClose };
}

describe('CodexOAuthLoginModal polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockStart.mockReset();
    mockPoll.mockReset();
    mockCancel.mockReset();
    mockStart.mockResolvedValue(deviceCodeSession());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delivers success from a poll while mounted', async () => {
    mockPoll.mockResolvedValue({ state: 'success', accountId: 'acct-1' });
    const { onSuccess } = renderModal();

    // Let the start call resolve and polling begin.
    await act(async () => {
      await Promise.resolve();
    });
    // Fire the first poll tick and flush its promise.
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
      await Promise.resolve();
    });

    expect(mockPoll).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith('acct-1');
  });

  it('ignores a poll that resolves after unmount', async () => {
    let resolvePoll!: (value: unknown) => void;
    mockPoll.mockImplementation(
      () =>
        new Promise(resolve => {
          resolvePoll = resolve;
        })
    );
    const { view, onSuccess } = renderModal();

    await act(async () => {
      await Promise.resolve();
    });
    // Start the first poll; its promise stays pending.
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    expect(mockPoll).toHaveBeenCalledTimes(1);

    view.unmount();

    // The in-flight poll resolves after teardown — the cancelled guard must
    // swallow it instead of invoking parent callbacks or setting state.
    await act(async () => {
      resolvePoll({ state: 'success', accountId: 'acct-late' });
      await Promise.resolve();
    });

    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('does not cancel the in-flight session on backdrop click or Escape', async () => {
    mockPoll.mockResolvedValue({ state: 'pending' });
    const { onClose } = renderModal();

    // Let the start call resolve so a session exists and polling is active.
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByTestId('modal-backdrop'));
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Sign in with ChatGPT' }), {
      key: 'Escape',
    });

    expect(mockCancel).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancels the session from the explicit Cancel button', async () => {
    mockPoll.mockResolvedValue({ state: 'pending' });
    mockCancel.mockResolvedValue(undefined);
    const { onClose } = renderModal();

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await Promise.resolve();
    });

    expect(mockCancel).toHaveBeenCalledWith('b1', 'p1', 's1');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
