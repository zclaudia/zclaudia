import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const useIsMobile = vi.fn(() => false);
vi.mock('../../../hooks/useMediaQuery', () => ({ useIsMobile: () => useIsMobile() }));

vi.mock('../debug/CrashReportsSection', () => ({
  CrashReportsSection: () => <div>Crash reports</div>,
}));
vi.mock('../debug/ManagedProcessesSection', () => ({
  ManagedProcessesSection: () => <div>Managed processes</div>,
}));
vi.mock('../debug/ClientLogsSection', () => ({ ClientLogsSection: () => <div>Client logs</div> }));
vi.mock('../debug/PermissionLogsSection', () => ({
  PermissionLogsSection: () => <div>Permission logs</div>,
}));
vi.mock('../debug/LeakedProcessCleanupSection', () => ({
  LeakedProcessCleanupSection: () => <div>Leaked process cleanup</div>,
}));
vi.mock('../debug/AiReviewSimulatorSection', () => ({
  AiReviewSimulatorSection: () => <div>AI review simulator</div>,
}));

import { DebugSettings } from '../DebugSettings';

describe('DebugSettings', () => {
  beforeEach(() => useIsMobile.mockReturnValue(false));

  it('renders the three group labels and all six sections on desktop', () => {
    render(<DebugSettings isConnected sendMessage={vi.fn()} />);
    for (const label of ['Diagnostics', 'Logs', 'Tools']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    for (const title of [
      'Crash reports',
      'Managed processes',
      'Client logs',
      'Permission logs',
      'Leaked process cleanup',
      'AI review simulator',
    ]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });

  it('keeps the read-only diagnostics on mobile but drops the host-acting tools', () => {
    useIsMobile.mockReturnValue(true);
    render(<DebugSettings isConnected sendMessage={vi.fn()} />);

    for (const title of ['Crash reports', 'Managed processes', 'Client logs', 'Permission logs']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(screen.queryByText('Leaked process cleanup')).toBeNull();
    expect(screen.queryByText('AI review simulator')).toBeNull();
    // Nothing left in Tools, so the labeled card goes too.
    expect(screen.queryByText('Tools')).toBeNull();
  });
});
