import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../contexts/ConnectionContext', () => ({
  useConnection: () => ({ embeddedServerStatus: 'ready', embeddedServerError: null, restartEmbeddedServer: vi.fn() }),
}));
vi.mock('../../../hooks/useMediaQuery', () => ({ useIsMobile: () => true }));
vi.mock('../../../utils/platform', () => ({ isMacOS: () => false }));
vi.mock('../ThemeToggle', () => ({ ThemeToggle: () => <div>theme-toggle</div> }));
vi.mock('../../../stores/uiStore', () => ({
  useUIStore: () => ({ fontSize: 'medium', setFontSize: vi.fn(), showNotchPanel: false, setShowNotchPanel: vi.fn(), notchMonitor: null, setNotchMonitor: vi.fn() }),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../services/api', () => ({ getServerInfo: vi.fn().mockResolvedValue({ sdkVersions: null }) }));

import { GeneralSettings } from '../GeneralSettings';

describe('GeneralSettings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders grouped sections with their rows', () => {
    render(<GeneralSettings isOpen activeServerExists={false} embeddedServerPort={3100} />);
    expect(screen.getByText('Appearance')).toBeTruthy();
    expect(screen.getByText('Local server')).toBeTruthy();
    expect(screen.getByText('About')).toBeTruthy();
    expect(screen.getByText('Theme')).toBeTruthy();
    expect(screen.getByText('Font size')).toBeTruthy();
    expect(screen.getByText('Embedded server runtime')).toBeTruthy();
    expect(screen.getByText('Version')).toBeTruthy();
    expect(screen.getByText('Runtime status')).toBeTruthy();
    expect(screen.getByText('ready')).toBeTruthy();
  });
});
