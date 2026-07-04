import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { UsageStatsStrip } from '../UsageStatsStrip';

const getUsageStats = vi.fn();
vi.mock('../../../services/api', () => ({
  getUsageStats: (...args: unknown[]) => getUsageStats(...args),
}));

const payload = {
  sessions: 241,
  messages: 32375,
  totalTokens: 39_900_000,
  currentStreakDays: 17,
  activeDays: [{ date: '2026-07-03', count: 5 }],
  capturedAt: 1,
};

describe('UsageStatsStrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the four numbers, heatmap, and fun line', async () => {
    getUsageStats.mockResolvedValue(payload);
    render(<UsageStatsStrip />);
    await waitFor(() => {
      expect(screen.getByText('241')).toBeTruthy();
    });
    expect(screen.getByText('32,375')).toBeTruthy();
    expect(screen.getByText('39.9M')).toBeTruthy();
    expect(screen.getByText('17d')).toBeTruthy();
    expect(screen.getByText('Sessions')).toBeTruthy();
    expect(screen.getByText(/more tokens than/)).toBeTruthy();
    expect(document.querySelector('[data-testid="usage-heatmap"]')).toBeTruthy();
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
    // The strip anchors the page visually even without activity — an empty
    // (all level-0) heatmap, GitHub-fresh-profile style.
    getUsageStats.mockResolvedValue({
      ...payload,
      sessions: 2,
      messages: 0,
      totalTokens: 0,
      currentStreakDays: 0,
      activeDays: [],
    });
    render(<UsageStatsStrip />);
    await waitFor(() => {
      expect(screen.getByText('Sessions')).toBeTruthy();
    });
    expect(screen.getByText('0d')).toBeTruthy();
    expect(document.querySelector('[data-testid="usage-heatmap"]')).toBeTruthy();
    expect(screen.queryByText(/more tokens than/)).toBeNull();
  });

  it('hides the fun line below the multiplier floor', async () => {
    getUsageStats.mockResolvedValue({ ...payload, totalTokens: 30_000 });
    render(<UsageStatsStrip />);
    await waitFor(() => {
      expect(screen.getByText('241')).toBeTruthy();
    });
    expect(screen.queryByText(/more tokens than/)).toBeNull();
  });
});
