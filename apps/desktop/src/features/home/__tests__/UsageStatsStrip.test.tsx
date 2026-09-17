import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UsageStatsStrip } from '../UsageStatsStrip';
import { useGatewayStore } from '../../../stores/gatewayStore';
import { useServerStore } from '../../../stores/serverStore';

const getUsageStats = vi.fn();
const getModelStats = vi.fn(() =>
  Promise.resolve({ days: [], models: [], trackedSince: null, capturedAt: 1 })
);
const getRuntimeUsage = vi.fn(() =>
  Promise.resolve({
    schemaVersion: 1,
    datasetId: 'ds-1',
    asOf: 1,
    timeZone: 'UTC',
    accountingSince: null,
    accountingActive: true,
    capturedAt: 1,
    totals: {
      recordedTokens: null,
      completeTokens: null,
      partialTokens: null,
      legacyTokens: null,
      activeRecordedTokens: null,
    },
    coverage: {
      complete: 0,
      partial: 0,
      missing: 0,
      eligibleFinalized: 0,
      inFlight: 0,
      rate: null,
      legacyRecordCount: 0,
    },
    runtimes: [],
    series: [],
  })
);
vi.mock('../../../services/api', () => ({
  getUsageStats: (...args: unknown[]) => getUsageStats(...args),
  getModelStats: (...args: unknown[]) => getModelStats(...args),
  getRuntimeUsage: (...args: unknown[]) => getRuntimeUsage(...args),
}));

const payload = {
  sessions: 241,
  messages: 32375,
  totalTokens: 39_900_000,
  activeDaysCount: 34,
  currentStreakDays: 17,
  longestStreakDays: 17,
  peakHour: 23,
  favoriteModel: 'claude-opus-4-8',
  allTimeTokens: 39_900_000,
  activeDays: [{ date: '2026-07-03', count: 5 }],
  capturedAt: 1,
};

describe('UsageStatsStrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    useGatewayStore.setState({ directGatewayUrl: null, directGatewaySecret: null });
    useServerStore.setState({ activeServerId: null });
  });

  it('reuses the captured details across tab switches without querying newer totals', async () => {
    const runtime = await getRuntimeUsage();
    getRuntimeUsage.mockClear();
    getUsageStats.mockResolvedValue({
      ...payload,
      details: {
        models: { days: [], models: [], trackedSince: null, capturedAt: 1 },
        runtime,
      },
    });
    render(<UsageStatsStrip />);
    await screen.findByText('Sessions');
    fireEvent.click(screen.getByRole('button', { name: 'Models', exact: true }));
    await screen.findByText(/No model data yet/);
    fireEvent.click(screen.getByRole('button', { name: 'Runtimes', exact: true }));
    await waitFor(() =>
      expect(document.querySelector('[data-testid="runtimes-view"]')).toBeTruthy()
    );
    expect(getModelStats).not.toHaveBeenCalled();
    expect(getRuntimeUsage).not.toHaveBeenCalled();
    expect(getUsageStats).toHaveBeenCalledTimes(1);
  });

  it('renders the numbers, heatmap, and fun line', async () => {
    getUsageStats.mockResolvedValue(payload);
    render(<UsageStatsStrip />);
    await waitFor(() => {
      expect(screen.getByText('241')).toBeTruthy();
    });
    expect(screen.getByText('32,375')).toBeTruthy();
    expect(screen.getByText('39.9M')).toBeTruthy();
    expect(screen.getAllByText('17d')).toHaveLength(2);
    expect(screen.getByText('Sessions')).toBeTruthy();
    expect(screen.getByText(/more tokens than/)).toBeTruthy();
    expect(document.querySelector('[data-testid="usage-heatmap"]')).toBeTruthy();
  });

  it('renders all eight metric cards with labels', async () => {
    getUsageStats.mockResolvedValue(payload);
    render(<UsageStatsStrip />);
    await waitFor(() => expect(screen.getByText('Sessions')).toBeTruthy());
    for (const label of [
      'Sessions',
      'Messages',
      'Total tokens',
      'Active days',
      'Current streak',
      'Longest streak',
      'Peak hour',
      'Favorite model',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('11 PM')).toBeTruthy();
    expect(screen.getByText('34')).toBeTruthy();
  });

  it('degrades gracefully against an old-server payload missing the new fields', async () => {
    // A stale local server (or a remote backend on an older version) returns
    // the pre-range payload shape. The four legacy cards render; the three
    // new ones are hidden instead of showing undefined/NaN.
    getUsageStats.mockResolvedValue({
      sessions: 3,
      messages: 4,
      totalTokens: 56_500,
      currentStreakDays: 1,
      activeDays: [{ date: '2026-07-04', count: 4 }],
      capturedAt: 1,
    });
    const { container } = render(<UsageStatsStrip />);
    await waitFor(() => expect(screen.getByText('Sessions')).toBeTruthy());
    expect(screen.getByText('56.5k')).toBeTruthy();
    expect(screen.queryByText('Active days')).toBeNull();
    expect(screen.queryByText('Longest streak')).toBeNull();
    expect(screen.queryByText('Peak hour')).toBeNull();
    expect(container.textContent).not.toContain('undefined');
    expect(container.textContent).not.toContain('NaN');
  });

  it('labels the tokens card "Recorded tokens" with a coverage line when the ledger is active', async () => {
    getUsageStats.mockResolvedValue({
      ...payload,
      accounting: {
        active: true,
        recordedTokens: 39_900_000,
        completeCalls: 92,
        partialCalls: 3,
        missingCalls: 8,
        eligibleFinalized: 100,
        inFlightCalls: 2,
        legacyRecords: 40,
        accountingSince: 1_758_000_000_000,
      },
    });
    render(<UsageStatsStrip />);
    await waitFor(() => expect(screen.getByText('Recorded tokens')).toBeTruthy());
    expect(screen.queryByText('Total tokens')).toBeNull();
    expect(screen.getByTestId('recorded-tokens-coverage').textContent).toBe(
      '92% fully reported · 8 missing'
    );
  });

  it('the coverage line links to the Runtimes tab fed by the ledger endpoint', async () => {
    getUsageStats.mockResolvedValue({
      ...payload,
      accounting: {
        active: true,
        recordedTokens: 39_900_000,
        completeCalls: 9,
        partialCalls: 0,
        missingCalls: 1,
        eligibleFinalized: 10,
        inFlightCalls: 0,
        legacyRecords: 0,
        accountingSince: 1_758_000_000_000,
      },
    });
    getRuntimeUsage.mockResolvedValue({
      schemaVersion: 1,
      datasetId: 'ds-1',
      asOf: 1,
      timeZone: 'UTC',
      accountingSince: 1_758_000_000_000,
      accountingActive: true,
      capturedAt: 1,
      totals: {
        recordedTokens: 123_456,
        completeTokens: 120_000,
        partialTokens: 3_456,
        legacyTokens: null,
        activeRecordedTokens: null,
      },
      coverage: {
        complete: 9,
        partial: 0,
        missing: 1,
        eligibleFinalized: 10,
        inFlight: 0,
        rate: 0.9,
        legacyRecordCount: 0,
      },
      runtimes: [
        {
          runtimeId: 'claude',
          runtimeLabel: 'Claude Code',
          recordedTokens: 100_000,
          inputTokens: 80_000,
          outputTokens: 20_000,
          calls: 8,
          completeCalls: 7,
          partialCalls: 0,
          missingCalls: 1,
          legacyCalls: 0,
          inFlightCalls: 0,
          coverageRate: 0.875,
          models: [],
        },
        {
          runtimeId: 'cursor',
          runtimeLabel: 'Cursor',
          recordedTokens: null,
          inputTokens: null,
          outputTokens: null,
          calls: 2,
          completeCalls: 0,
          partialCalls: 0,
          missingCalls: 2,
          legacyCalls: 0,
          inFlightCalls: 0,
          coverageRate: 0,
          models: [],
        },
      ],
      series: [],
    });
    render(<UsageStatsStrip />);
    await waitFor(() => expect(screen.getByText('Recorded tokens')).toBeTruthy());
    expect(screen.getByTestId('recorded-tokens-coverage').textContent).toBe(
      '90% fully reported · 1 missing'
    );
    fireEvent.click(screen.getByTestId('recorded-tokens-coverage'));
    await waitFor(() => expect(screen.getByTestId('runtimes-view')).toBeTruthy());
    expect(getRuntimeUsage).toHaveBeenCalled();
    // Legacy-style honesty: Cursor reports missing rather than a fabricated 0.
    expect(screen.getByText('Claude Code')).toBeTruthy();
    expect(screen.getByText('Cursor')).toBeTruthy();
    fireEvent.click(screen.getByText('Cursor'));
    expect(
      await screen.findByText('No token usage reported by this version of Cursor.')
    ).toBeTruthy();
  });

  it('hides the peak hour card when null', async () => {
    getUsageStats.mockResolvedValue({ ...payload, peakHour: null });
    render(<UsageStatsStrip />);
    await waitFor(() => expect(screen.getByText('Sessions')).toBeTruthy());
    expect(screen.queryByText('Peak hour')).toBeNull();
  });

  it('shows the favorite model card with a pretty name, hidden when null', async () => {
    getUsageStats.mockResolvedValue(payload);
    render(<UsageStatsStrip />);
    await waitFor(() => expect(screen.getByText('Favorite model')).toBeTruthy());
    expect(screen.getByText('Opus 4 8')).toBeTruthy();
  });

  it('hides the favorite model card when null', async () => {
    getUsageStats.mockResolvedValue({ ...payload, favoriteModel: null });
    render(<UsageStatsStrip />);
    await waitFor(() => expect(screen.getByText('Sessions')).toBeTruthy());
    expect(screen.queryByText('Favorite model')).toBeNull();
  });

  it('refetches with the chosen range without presenting the previous range as current', async () => {
    getUsageStats.mockResolvedValueOnce(payload);
    let resolveSecond!: (v: unknown) => void;
    getUsageStats.mockImplementationOnce(() => new Promise(resolve => (resolveSecond = resolve)));
    render(<UsageStatsStrip />);
    await waitFor(() => expect(screen.getByText('241')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '7d' }));
    expect(getUsageStats).toHaveBeenLastCalledWith(expect.anything(), '7d', {
      asOf: expect.any(Number),
      includeDetails: true,
    });
    // The previous range must not appear under the new range selection.
    expect(screen.queryByText('241')).toBeNull();
    resolveSecond({ ...payload, sessions: 9 });
    await waitFor(() => expect(screen.getByText('9')).toBeTruthy());
  });

  it('computes the fun line from all-time tokens regardless of range', async () => {
    getUsageStats.mockResolvedValue({ ...payload, totalTokens: 10_000 });
    render(<UsageStatsStrip />);
    await waitFor(() => expect(screen.getByText('Sessions')).toBeTruthy());
    expect(screen.getByText(/more tokens than/)).toBeTruthy(); // allTimeTokens still 39.9M
  });

  it('shows a compact unavailable notice on fetch failure instead of vanishing', async () => {
    getUsageStats.mockRejectedValue(new Error('nope'));
    render(<UsageStatsStrip />);
    await waitFor(() => {
      expect(screen.getByText(/Usage stats are unavailable/)).toBeTruthy();
    });
    expect(screen.queryByText('Sessions')).toBeNull();
  });

  it('recovers from the unavailable state once a backend becomes reachable', async () => {
    // Mobile cold start: gateway-direct with no active backend yet, then a
    // backend connects — the resolver flips and the panel loads.
    useGatewayStore.setState({ directGatewayUrl: 'wss://gw.example', directGatewaySecret: 's' });
    getUsageStats.mockResolvedValue(payload);
    render(<UsageStatsStrip />);
    await waitFor(() => expect(screen.getByText(/Usage stats are unavailable/)).toBeTruthy());
    expect(getUsageStats).not.toHaveBeenCalled();
    act(() => {
      useServerStore.setState({ activeServerId: 'remote-be-9' });
    });
    await waitFor(() => expect(screen.getByText('Sessions')).toBeTruthy());
    expect(getUsageStats).toHaveBeenCalledWith('remote-be-9', 'all', {
      asOf: expect.any(Number),
      includeDetails: true,
    });
    expect(screen.queryByText(/Usage stats are unavailable/)).toBeNull();
  });

  it('targets the active backend in gateway-direct mode (no local backend)', async () => {
    useGatewayStore.setState({ directGatewayUrl: 'wss://gw.example', directGatewaySecret: 's' });
    useServerStore.setState({ activeServerId: 'remote-be-9' });
    getUsageStats.mockResolvedValue(payload);
    render(<UsageStatsStrip />);
    await waitFor(() => expect(screen.getByText('Sessions')).toBeTruthy());
    expect(getUsageStats).toHaveBeenCalledWith('remote-be-9', 'all', {
      asOf: expect.any(Number),
      includeDetails: true,
    });
  });

  it('shows the unavailable notice without fetching when no backend exists at all', async () => {
    useGatewayStore.setState({ directGatewayUrl: 'wss://gw.example', directGatewaySecret: 's' });
    render(<UsageStatsStrip />);
    await waitFor(() => {
      expect(screen.getByText(/Usage stats are unavailable/)).toBeTruthy();
    });
    expect(getUsageStats).not.toHaveBeenCalled();
  });

  it('renders zeros and an empty heatmap before the first message', async () => {
    // The panel anchors the page visually even without activity — an empty
    // (all level-0) heatmap, GitHub-fresh-profile style.
    getUsageStats.mockResolvedValue({
      ...payload,
      sessions: 2,
      messages: 0,
      totalTokens: 0,
      activeDaysCount: 0,
      currentStreakDays: 0,
      longestStreakDays: 0,
      peakHour: null,
      allTimeTokens: 0,
      activeDays: [],
    });
    render(<UsageStatsStrip />);
    await waitFor(() => {
      expect(screen.getByText('Sessions')).toBeTruthy();
    });
    expect(screen.getAllByText('0d').length).toBeGreaterThan(0);
    expect(document.querySelector('[data-testid="usage-heatmap"]')).toBeTruthy();
    expect(screen.queryByText(/more tokens than/)).toBeNull();
  });

  it('shows 13 heatmap columns below md: and 26 from md: up', async () => {
    getUsageStats.mockResolvedValue(payload);
    render(<UsageStatsStrip />);
    await waitFor(() => expect(screen.getByText('241')).toBeTruthy());
    const heatmap = document.querySelector('[data-testid="usage-heatmap"]')!;
    expect(heatmap.className).toContain('grid-cols-[repeat(13,minmax(0,1fr))]');
    expect(heatmap.className).toContain('md:grid-cols-[repeat(26,minmax(0,1fr))]');
    // Row-major cells: within each 26-cell row, exactly the older 13 weeks
    // are hidden below md: so the mobile grid stays 13 columns wide.
    const cells = Array.from(heatmap.children);
    expect(cells).toHaveLength(26 * 7);
    cells.forEach((cell, i) => {
      expect(cell.className.includes('hidden md:block')).toBe(i % 26 < 13);
    });
  });

  it('surfaces a tapped heatmap day as an inline caption and toggles it off', async () => {
    getUsageStats.mockResolvedValue(payload);
    render(<UsageStatsStrip />);
    await waitFor(() => expect(screen.getByText('241')).toBeTruthy());
    expect(screen.queryByTestId('heatmap-day-caption')).toBeNull();
    const cell = screen.getByTitle('2026-07-03: 5 messages');
    fireEvent.click(cell);
    const caption = screen.getByTestId('heatmap-day-caption');
    expect(caption.textContent).toContain('Jul 3, 2026');
    expect(caption.textContent).toContain('5 messages');
    // Desktop keeps the hover title; the caption is mobile-only chrome.
    expect(caption.className).toContain('md:hidden');
    fireEvent.click(cell);
    expect(screen.queryByTestId('heatmap-day-caption')).toBeNull();
  });

  it('clears the tapped-day caption when the range changes', async () => {
    getUsageStats.mockResolvedValue(payload);
    render(<UsageStatsStrip />);
    await waitFor(() => expect(screen.getByText('241')).toBeTruthy());
    fireEvent.click(screen.getByTitle('2026-07-03: 5 messages'));
    expect(screen.getByTestId('heatmap-day-caption')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '7d' }));
    await waitFor(() => expect(screen.queryByTestId('heatmap-day-caption')).toBeNull());
  });

  it('switches to the Models tab and back', async () => {
    getUsageStats.mockResolvedValue(payload);
    render(<UsageStatsStrip />);
    await waitFor(() => expect(screen.getByText('Sessions')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Models' }));
    await waitFor(() => expect(screen.getByText(/No model data yet/)).toBeTruthy());
    expect(screen.queryByText('Sessions')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(screen.getByText('Sessions')).toBeTruthy();
  });

  it('hides the fun line below the multiplier floor', async () => {
    getUsageStats.mockResolvedValue({ ...payload, allTimeTokens: 30_000 });
    render(<UsageStatsStrip />);
    await waitFor(() => {
      expect(screen.getByText('241')).toBeTruthy();
    });
    expect(screen.queryByText(/more tokens than/)).toBeNull();
  });
});
