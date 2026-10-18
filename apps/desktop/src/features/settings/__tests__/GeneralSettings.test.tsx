import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../ThemeToggle', () => ({ ThemeToggle: () => <div>theme-toggle</div> }));
vi.mock('../../../stores/uiStore', () => ({
  useUIStore: () => ({
    fontSize: 'medium',
    setFontSize: vi.fn(),
  }),
}));
vi.mock('../../../services/api', () => ({
  getAutoTitleConfig: vi.fn().mockResolvedValue({
    enabled: true,
    model: null,
    createdAt: 0,
    updatedAt: 0,
  }),
  updateAutoTitleConfig: vi.fn(),
}));

import { GeneralSettings } from '../GeneralSettings';

describe('GeneralSettings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the Appearance and Session titles sections', () => {
    render(<GeneralSettings />);
    expect(screen.getByText('Appearance')).toBeTruthy();
    expect(screen.getByText('Theme')).toBeTruthy();
    expect(screen.getByText('Font size')).toBeTruthy();
    expect(screen.getByText('Session titles')).toBeTruthy();
    expect(screen.getByText('Auto-generate titles')).toBeTruthy();
    expect(screen.queryByText('Notification Panel')).toBeNull();
    expect(screen.queryByText('Notification Display')).toBeNull();
  });

  it('no longer renders the Local server, Permissions, or About sections', () => {
    render(<GeneralSettings />);
    expect(screen.queryByText('Local server')).toBeNull();
    expect(screen.queryByText('Embedded server runtime')).toBeNull();
    expect(screen.queryByText('Permissions')).toBeNull();
    expect(screen.queryByText('About')).toBeNull();
    expect(screen.queryByText('Version')).toBeNull();
  });
});
