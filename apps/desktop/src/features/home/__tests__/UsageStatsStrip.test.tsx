import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UsageStatsStrip } from '../UsageStatsStrip';

const getUsageStats = vi.fn();
const getModelStats = vi.fn(() =>
  Promise.resolve({ days: [], models: [], trackedSince: null, capturedAt: 1 })
);
vi.mock('../../../services/api', () => ({
  getUsageStats: (...args: unknown[]) => getUsageStats(...args),
  getModelStats: (...args: unknown[]) => getModelStats(...args),
}));

const payload = {
  sessions: 241,
  messages: 32375,
  totalTokens: 39_900_000,
  activeDaysCount: 34,
  currentStreakDays: 17,
  longestStreakDays: 17,
  peakHour: 23,
  allTimeTokens: 39_900_000,
  activeDays: [{ date: '2026-07-03', count: 5 }],
  capturedAt: 1,
};

describe('UsageStatsStrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('renders all seven metric cards with labels', async () => {
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

  it('hides the peak hour card when null', async () => {
    getUsageStats.mockResolvedValue({ ...payload, peakHour: null });
    render(<UsageStatsStrip />);
    await waitFor(() => expect(screen.getByText('Sessions')).toBeTruthy());
    expect(screen.queryByText('Peak hour')).toBeNull();
  });

  it('refetches with the chosen range and keeps previous numbers while pending', async () => {
    getUsageStats.mockResolvedValueOnce(payload);
    let resolveSecond!: (v: unknown) => void;
    getUsageStats.mockImplementationOnce(
      () => new Promise(resolve => (resolveSecond = resolve))
    );
    render(<UsageStatsStrip />);
    await waitFor(() => expect(screen.getByText('241')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '7d' }));
    expect(getUsageStats).toHaveBeenLastCalledWith(expect.anything(), '7d');
    // Previous data still visible while the refetch is pending.
    expect(screen.getByText('241')).toBeTruthy();
    resolveSecond({ ...payload, sessions: 9 });
    await waitFor(() => expect(screen.getByText('9')).toBeTruthy());
  });

  it('computes the fun line from all-time tokens regardless of range', async () => {
    getUsageStats.mockResolvedValue({ ...payload, totalTokens: 10_000 });
    render(<UsageStatsStrip />);
    await waitFor(() => expect(screen.getByText('Sessions')).toBeTruthy());
    expect(screen.getByText(/more tokens than/)).toBeTruthy(); // allTimeTokens still 39.9M
  });

  it('renders nothing on fetch failure', async () => {
    getUsageStats.mockRejectedValue(new Error('nope'));
    const { container } = render(<UsageStatsStrip />);
    await waitFor(() => {
      expect(getUsageStats).toHaveBeenCalled();
    });
    expect(container.innerHTML).toBe('');
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
