import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../hooks/useMediaQuery', () => ({ useIsMobile: () => true }));
vi.mock('../ThemeToggle', () => ({ ThemeToggle: () => <div>theme-toggle</div> }));
vi.mock('../../../stores/uiStore', () => ({
  useUIStore: () => ({
    fontSize: 'medium',
    setFontSize: vi.fn(),
    showNotchPanel: false,
    setShowNotchPanel: vi.fn(),
    notchMonitor: null,
    setNotchMonitor: vi.fn(),
  }),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

import { GeneralSettings } from '../GeneralSettings';

describe('GeneralSettings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders only the Appearance section', () => {
    render(<GeneralSettings />);
    expect(screen.getByText('Appearance')).toBeTruthy();
    expect(screen.getByText('Theme')).toBeTruthy();
    expect(screen.getByText('Font size')).toBeTruthy();
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
