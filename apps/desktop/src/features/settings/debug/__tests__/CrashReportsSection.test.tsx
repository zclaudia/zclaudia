import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const getCrashReports = vi.fn().mockResolvedValue({ reports: [], filePath: '/tmp/crash.jsonl' });
vi.mock('../../../../services/api', () => ({ getCrashReports: () => getCrashReports() }));

const targetBackendId = vi.fn<() => string | null>(() => 'backend-1');
vi.mock('../../../../hooks/useSettingsTargetBackend', () => ({
  useSettingsTargetBackend: () => ({
    targetBackendId: targetBackendId(),
    isLocalTarget: false,
    targetBackendName: 'Studio',
  }),
}));

import { CrashReportsSection } from '../CrashReportsSection';

describe('CrashReportsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    targetBackendId.mockReturnValue('backend-1');
  });

  it('loads on mount and shows the empty state + path', async () => {
    render(<CrashReportsSection />);
    await waitFor(() => expect(getCrashReports).toHaveBeenCalled());
    expect(screen.getByText('No crash reports recorded.')).toBeTruthy();
    expect(await screen.findByText('/tmp/crash.jsonl')).toBeTruthy();
  });

  it('loads against a remote backend even though this device runs no embedded server', async () => {
    // Mobile and the browser shell have no embedded server, but they are
    // connected to one that does have crash reports. The old gate read the
    // embedded server's status and reported "none recorded" on both.
    render(<CrashReportsSection />);
    await waitFor(() => expect(getCrashReports).toHaveBeenCalled());
  });

  it('does not query, and says why, when no backend is connected', () => {
    targetBackendId.mockReturnValue(null);
    render(<CrashReportsSection />);
    expect(getCrashReports).not.toHaveBeenCalled();
    expect(screen.getByText('Connect to a backend to read its crash reports.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });
});
