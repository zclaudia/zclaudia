import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ModelsChart } from '../ModelsChart';
import { useGatewayStore } from '../../../stores/gatewayStore';
import { useServerStore } from '../../../stores/serverStore';

const getModelStats = vi.fn();
vi.mock('../../../services/api', () => ({
  getModelStats: (...args: unknown[]) => getModelStats(...args),
}));

const mediaState = vi.hoisted(() => ({ isMobile: false }));
vi.mock('../../../hooks/useMediaQuery', () => ({
  useIsMobile: () => mediaState.isMobile,
}));

const payload = {
  days: [
    { date: '2026-07-03', models: { 'claude-fable-5': 600, 'deepseek-v4-flash': 400 } },
    { date: '2026-07-04', models: { 'claude-fable-5': 2000 } },
  ],
  models: [
    { model: 'claude-fable-5', inTokens: 1700, outTokens: 900, totalTokens: 2600, share: 0.867 },
    { model: 'deepseek-v4-flash', inTokens: 300, outTokens: 100, totalTokens: 400, share: 0.133 },
  ],
  trackedSince: new Date('2026-07-04T10:00:00').getTime(),
  capturedAt: 1,
};

describe('ModelsChart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mediaState.isMobile = false;
  });

  afterEach(() => {
    useGatewayStore.setState({ directGatewayUrl: null, directGatewaySecret: null });
    useServerStore.setState({ activeServerId: null });
  });

  it('renders the chart, legend rows with pretty names and shares, and the footnote', async () => {
    getModelStats.mockResolvedValue(payload);
    render(<ModelsChart range="all" />);
    await waitFor(() => expect(screen.getByText('Fable 5')).toBeTruthy());
    expect(screen.getByText('Deepseek V4 Flash')).toBeTruthy();
    expect(screen.getByText('86.7%')).toBeTruthy();
    expect(screen.getByText(/1\.7k in · 900 out/)).toBeTruthy();
    expect(document.querySelector('[data-testid="models-chart-svg"]')).toBeTruthy();
    expect(screen.getByText(/Model tracking started/)).toBeTruthy();
  });

  it('collapses the legend past five entries', async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      model: `model-${i}`,
      inTokens: 10,
      outTokens: 10,
      totalTokens: 20,
      share: 1 / 7,
    }));
    getModelStats.mockResolvedValue({ ...payload, models: many });
    render(<ModelsChart range="all" />);
    await waitFor(() => expect(screen.getByText('Model 0')).toBeTruthy());
    expect(screen.queryByText('Model 5')).toBeNull();
    fireEvent.click(screen.getByText('Show 2 more'));
    expect(screen.getByText('Model 5')).toBeTruthy();
    expect(screen.getByText('Model 6')).toBeTruthy();
  });

  it('shows the empty state when nothing is tagged yet', async () => {
    getModelStats.mockResolvedValue({ days: [], models: [], trackedSince: null, capturedAt: 1 });
    render(<ModelsChart range="all" />);
    await waitFor(() => expect(getModelStats).toHaveBeenCalled());
    expect(screen.getByText(/No model data yet/)).toBeTruthy();
  });

  it('refetches when the range changes', async () => {
    getModelStats.mockResolvedValue(payload);
    const { rerender } = render(<ModelsChart range="all" />);
    await waitFor(() => expect(getModelStats).toHaveBeenCalledTimes(1));
    rerender(<ModelsChart range="7d" />);
    await waitFor(() => expect(getModelStats).toHaveBeenCalledTimes(2));
    expect(getModelStats).toHaveBeenLastCalledWith(expect.anything(), '7d');
  });

  it('shows a compact unavailable notice on fetch failure instead of vanishing', async () => {
    getModelStats.mockRejectedValue(new Error('nope'));
    render(<ModelsChart range="all" />);
    await waitFor(() => {
      expect(screen.getByText(/Model stats are unavailable/)).toBeTruthy();
    });
    expect(document.querySelector('[data-testid="models-chart-svg"]')).toBeNull();
  });

  it('keeps the 560-wide desktop viewBox by default', async () => {
    getModelStats.mockResolvedValue(payload);
    render(<ModelsChart range="all" />);
    await waitFor(() => expect(screen.getByText('Fable 5')).toBeTruthy());
    const svg = document.querySelector('[data-testid="models-chart-svg"]')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 560 150');
  });

  it('uses a narrower viewBox on mobile so axis and day labels stay legible', async () => {
    mediaState.isMobile = true;
    getModelStats.mockResolvedValue(payload);
    render(<ModelsChart range="all" />);
    await waitFor(() => expect(screen.getByText('Fable 5')).toBeTruthy());
    const svg = document.querySelector('[data-testid="models-chart-svg"]')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 320 150');
  });

  it('lets the in/out span shrink so the model name keeps most of the row', async () => {
    getModelStats.mockResolvedValue(payload);
    render(<ModelsChart range="all" />);
    await waitFor(() => expect(screen.getByText('Fable 5')).toBeTruthy());
    const name = screen.getByText('Fable 5');
    expect(name.className).toContain('flex-1');
    expect(name.className).toContain('min-w-[40%]');
    const inOut = screen.getByText(/1\.7k in · 900 out/);
    expect(inOut.className).toContain('truncate');
    expect(inOut.className).toContain('min-w-0');
    expect(inOut.className).not.toContain('shrink-0');
  });

  it('targets the active backend in gateway-direct mode (no local backend)', async () => {
    useGatewayStore.setState({ directGatewayUrl: 'wss://gw.example', directGatewaySecret: 's' });
    useServerStore.setState({ activeServerId: 'remote-be-9' });
    getModelStats.mockResolvedValue(payload);
    render(<ModelsChart range="all" />);
    await waitFor(() => expect(screen.getByText('Fable 5')).toBeTruthy());
    expect(getModelStats).toHaveBeenCalledWith('remote-be-9', 'all');
  });
});
