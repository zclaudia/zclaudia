import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  getAutoTitleConfig: vi.fn(),
  updateAutoTitleConfig: vi.fn(),
}));
vi.mock('../../../services/api', () => api);

import { AutoTitleSettings } from '../AutoTitleSettings';

const config = (over: Partial<Record<string, unknown>> = {}) => ({
  enabled: true,
  model: null,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('AutoTitleSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getAutoTitleConfig.mockResolvedValue(config());
    api.updateAutoTitleConfig.mockImplementation(async (req: unknown) => config(req as object));
  });

  it('loads the config into the toggle', async () => {
    render(<AutoTitleSettings />);
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Auto-generate session titles' })).toBeTruthy()
    );
    expect(
      (
        screen.getByRole('switch', { name: 'Auto-generate session titles' }) as HTMLElement
      ).getAttribute('aria-checked')
    ).toBe('true');
  });

  it('saves the toggle change immediately', async () => {
    render(<AutoTitleSettings />);
    const toggle = await screen.findByRole('switch', { name: 'Auto-generate session titles' });
    fireEvent.click(toggle);
    await waitFor(() => expect(api.updateAutoTitleConfig).toHaveBeenCalledWith({ enabled: false }));
  });

  it('commits a typed model on Enter and skips unchanged values', async () => {
    render(<AutoTitleSettings />);
    const input = await screen.findByLabelText('Title model');
    fireEvent.change(input, { target: { value: 'cheap-model' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(api.updateAutoTitleConfig).toHaveBeenCalledWith({ model: 'cheap-model' })
    );

    api.updateAutoTitleConfig.mockClear();
    fireEvent.change(input, { target: { value: 'cheap-model' } });
    fireEvent.blur(input);
    await new Promise(r => setImmediate(r));
    expect(api.updateAutoTitleConfig).not.toHaveBeenCalled();
  });
});
