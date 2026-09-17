import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { RuntimeUsagePayload } from '@zclaudia/shared';
import { RuntimesView } from '../RuntimesView';

const { getRuntimeUsage } = vi.hoisted(() => ({ getRuntimeUsage: vi.fn() }));
vi.mock('../../../services/api', () => ({ getRuntimeUsage }));
vi.mock('../statsBackend', () => ({
  useStatsBackendTargets: () => [
    { backendId: 'a', name: 'A' },
    { backendId: 'b', name: 'B' },
  ],
}));
function payload(): RuntimeUsagePayload {
  return {
    schemaVersion: 1,
    datasetId: 'a',
    asOf: 1,
    timeZone: 'UTC',
    accountingSince: null,
    accountingActive: true,
    capturedAt: 1,
    totals: {
      recordedTokens: 1234,
      completeTokens: 1234,
      partialTokens: null,
      legacyTokens: null,
      activeRecordedTokens: null,
    },
    coverage: {
      complete: 1,
      partial: 0,
      missing: 0,
      eligibleFinalized: 1,
      inFlight: 0,
      rate: 1,
      legacyRecordCount: 0,
    },
    runtimes: [],
    series: [],
  };
}
beforeEach(() => {
  getRuntimeUsage.mockReset();
});
describe('RuntimesView data quality', () => {
  it('shows failed sources in the denominator', async () => {
    getRuntimeUsage.mockImplementation((id: string) =>
      id === 'a' ? Promise.resolve(payload()) : Promise.reject(new Error('offline'))
    );
    render(<RuntimesView range="all" />);
    expect(await screen.findByText('received 1/2 sources')).toBeTruthy();
  });
  it('clears the previous range while the new one is loading', async () => {
    getRuntimeUsage.mockResolvedValue(payload());
    const view = render(<RuntimesView range="all" />);
    await screen.findByTestId('runtimes-view');
    getRuntimeUsage.mockImplementation(() => new Promise(() => {}));
    view.rerender(<RuntimesView range="7d" />);
    await waitFor(() => expect(screen.queryByTestId('runtimes-view')).toBeNull());
  });
  it('keeps older dates in All charts instead of truncating to 60 days', async () => {
    const data = payload();
    data.series = Array.from({ length: 70 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
      runtimes: { codex: 100 },
    }));
    getRuntimeUsage.mockResolvedValue(data);
    render(<RuntimesView range="all" />);
    const chart = await screen.findByTestId('runtime-usage-chart');
    expect(chart.textContent).toContain('2026-01-01');
    expect(chart.textContent).toContain(data.series.at(-1)!.date);
  });
});
