import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen, fireEvent } from '@testing-library/react';

const { mockPoll, mockCancel } = vi.hoisted(() => ({
  mockPoll: vi.fn(),
  mockCancel: vi.fn(),
}));

vi.mock('../../../services/api', () => ({
  pollMcpOAuthStatusForBackend: mockPoll,
  cancelMcpOAuthForBackend: mockCancel,
}));

import { McpOAuthLoginModal } from '../McpOAuthLoginModal';

function browserSession() {
  return {
    sessionId: 's1',
    method: 'browser' as const,
    authUrl: 'https://example.com/auth',
  };
}

function renderModal(onSuccess = vi.fn(), onClose = vi.fn()) {
  const view = render(
    <McpOAuthLoginModal
      backendId="b1"
      serverName="github"
      session={browserSession() as never}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
  return { view, onSuccess, onClose };
}

describe('McpOAuthLoginModal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockPoll.mockReset();
    mockCancel.mockReset();
    mockPoll.mockResolvedValue({ state: 'pending' });
    mockCancel.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the waiting state while polling', () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: 'MCP OAuth Login' })).toBeTruthy();
    expect(screen.getByText('Waiting for browser authorization callback...')).toBeTruthy();
    expect(screen.getByText('https://example.com/auth')).toBeTruthy();
  });

  it('cancels the session from the explicit Close button', async () => {
    const { onClose } = renderModal();

    // Both the header x and the footer Close button share the accessible name
    // "Close"; the footer button is the last one. Both route through handleClose.
    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    await act(async () => {
      fireEvent.click(closeButtons[closeButtons.length - 1]);
      await Promise.resolve();
    });

    expect(mockCancel).toHaveBeenCalledWith('b1', 'github', 's1');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not cancel the in-flight session on backdrop click or Escape', () => {
    const { onClose } = renderModal();

    fireEvent.click(screen.getByTestId('modal-backdrop'));
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'MCP OAuth Login' }), {
      key: 'Escape',
    });

    expect(mockCancel).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reports success once polling resolves', async () => {
    mockPoll.mockResolvedValue({ state: 'success' });
    const { onSuccess } = renderModal();

    // First poll fires after the initial 1s delay.
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(mockPoll).toHaveBeenCalledWith('b1', 'github', 's1');
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
