import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type {
  LanguageServerStatusEntry,
  SessionLanguageServers,
} from '@zclaudia/shared/core/language-servers';
import { LanguageServerIndicator } from '../LanguageServerIndicator';

vi.mock('../../../services/api', () => ({
  getSessionLanguageServers: vi.fn(),
}));
import { getSessionLanguageServers } from '../../../services/api';

const mockFetch = vi.mocked(getSessionLanguageServers);

function server(overrides: Partial<LanguageServerStatusEntry> = {}): LanguageServerStatusEntry {
  return {
    id: 'typescript',
    name: 'TypeScript',
    languages: ['typescript'],
    root: '/work/app',
    state: 'ready',
    leases: 1,
    openDocuments: 12,
    pid: 42,
    startedAt: 1,
    lastUsedAt: 2,
    lastError: null,
    installHint: null,
    source: 'builtin',
    pluginId: null,
    ...overrides,
  };
}

function payload(overrides: Partial<SessionLanguageServers> = {}): SessionLanguageServers {
  return { applicable: true, enabled: true, root: '/work/app', servers: [server()], ...overrides };
}

// Block body: a function returned from beforeEach is run as a cleanup hook,
// and mockReset() returns the mock itself.
beforeEach(() => {
  mockFetch.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('LanguageServerIndicator', () => {
  it.each([
    ['an external runtime', payload({ applicable: false, servers: [] })],
    ['the switch is off', payload({ enabled: false, servers: [] })],
    ['no server is detected', payload({ servers: [] })],
  ])('renders nothing when %s', async (_label, data) => {
    mockFetch.mockResolvedValue(data);
    const { container } = render(<LanguageServerIndicator sessionId="s1" />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('s1'));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the backend has no such endpoint', async () => {
    mockFetch.mockRejectedValue(new Error('404'));
    const { container } = render(<LanguageServerIndicator sessionId="s1" />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the worst state on the dot and every server in the popover', async () => {
    mockFetch.mockResolvedValue(
      payload({
        servers: [
          server(),
          server({
            id: 'rust-analyzer',
            name: 'Rust (rust-analyzer)',
            state: 'failed',
            lastError: "Unknown binary 'rust-analyzer'",
          }),
        ],
      })
    );
    render(<LanguageServerIndicator sessionId="s1" />);
    const trigger = await screen.findByTestId('language-server-indicator');
    expect(trigger).toHaveAttribute('data-state', 'failed');
    expect(trigger.getAttribute('aria-label')).toContain('TypeScript: Ready · 12 open files');

    fireEvent.click(trigger);
    const popover = await screen.findByTestId('language-server-popover');
    expect(popover).toHaveTextContent('TypeScript');
    expect(popover).toHaveTextContent('Ready · 12 open files');
    expect(popover).toHaveTextContent('Failed');
    expect(popover).toHaveTextContent("Unknown binary 'rust-analyzer'");
  });

  it('shows a needed but uninstalled server without alarm, with its install command', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    mockFetch.mockResolvedValue(
      payload({
        servers: [
          server({
            id: 'rust-analyzer',
            name: 'Rust (rust-analyzer)',
            state: 'missing',
            leases: 0,
            openDocuments: 0,
            pid: null,
            installHint: 'rustup component add rust-analyzer',
          }),
        ],
      })
    );
    render(<LanguageServerIndicator sessionId="s1" />);
    const trigger = await screen.findByTestId('language-server-indicator');
    expect(trigger).toHaveAttribute('data-state', 'missing');

    fireEvent.click(trigger);
    const popover = await screen.findByTestId('language-server-popover');
    expect(popover).toHaveTextContent('Not installed');
    expect(popover).toHaveTextContent('rustup component add rust-analyzer');
    fireEvent.click(
      screen.getByRole('button', { name: 'Copy command: rustup component add rust-analyzer' })
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('rustup component add rust-analyzer')
    );
    // Copying does not close the popover.
    expect(screen.getByTestId('language-server-popover')).toBeInTheDocument();
  });

  it('polls quickly while a server is starting, then settles', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetch
      .mockResolvedValueOnce(payload({ servers: [server({ state: 'starting' })] }))
      .mockResolvedValue(payload());
    render(<LanguageServerIndicator sessionId="s1" />);
    const trigger = await screen.findByTestId('language-server-indicator');
    expect(trigger).toHaveAttribute('data-state', 'starting');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    await waitFor(() => expect(trigger).toHaveAttribute('data-state', 'ready'));
    const callsAfterReady = mockFetch.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(mockFetch.mock.calls.length).toBe(callsAfterReady); // settled: next poll is 15s out
  });

  it('refreshes when a run starts and watches idle servers closely during it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetch.mockResolvedValue(payload({ servers: [server({ state: 'idle' })] }));
    const { rerender } = render(<LanguageServerIndicator sessionId="s1" />);
    await screen.findByTestId('language-server-indicator');
    const before = mockFetch.mock.calls.length;

    rerender(<LanguageServerIndicator sessionId="s1" runActive />);
    await waitFor(() => expect(mockFetch.mock.calls.length).toBe(before + 1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(mockFetch.mock.calls.length).toBe(before + 2); // fast poll, not 15s
  });
});
