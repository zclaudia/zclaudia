import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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
  it('renders the three group labels and all six sections', () => {
    render(<DebugSettings isConnected sendMessage={vi.fn()} embeddedServerStatus="running" />);
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
});
