import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../ThemeToggle', () => ({ ThemeToggle: () => <div>theme-toggle</div> }));
vi.mock('../../../stores/uiStore', () => ({
  useUIStore: () => ({
    fontSize: 'medium',
    setFontSize: vi.fn(),
  }),
}));

import { GeneralSettings } from '../GeneralSettings';

describe('GeneralSettings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders only the Appearance section', () => {
    render(<GeneralSettings />);
    expect(screen.getByText('Appearance')).toBeTruthy();
    expect(screen.getByText('Theme')).toBeTruthy();
    expect(screen.getByText('Font size')).toBeTruthy();
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
