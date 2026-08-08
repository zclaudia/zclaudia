import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const getManagedProcesses = vi.fn().mockResolvedValue([]);
vi.mock('../../../../services/api', () => ({ getManagedProcesses: () => getManagedProcesses() }));

const targetBackendId = vi.fn<() => string | null>(() => 'backend-1');
vi.mock('../../../../hooks/useSettingsTargetBackend', () => ({
  useSettingsTargetBackend: () => ({
    targetBackendId: targetBackendId(),
    isLocalTarget: false,
    targetBackendName: 'Studio',
  }),
}));

import { ManagedProcessesSection } from '../ManagedProcessesSection';

describe('ManagedProcessesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    targetBackendId.mockReturnValue('backend-1');
  });
  afterEach(() => vi.useRealTimers());

  it('polls on mount and renders the empty state', async () => {
    render(<ManagedProcessesSection />);
    await vi.waitFor(() => expect(getManagedProcesses).toHaveBeenCalled());
    expect(await screen.findByText('No managed processes recorded yet.')).toBeTruthy();
  });

  it('polls a remote backend even though this device runs no embedded server', async () => {
    // The old gate keyed off the embedded server, so mobile and the browser
    // shell never polled and claimed nothing was running on a busy host.
    render(<ManagedProcessesSection />);
    await vi.waitFor(() => expect(getManagedProcesses).toHaveBeenCalled());
  });

  it('does not poll, and says why, when no backend is connected', () => {
    targetBackendId.mockReturnValue(null);
    render(<ManagedProcessesSection />);
    expect(getManagedProcesses).not.toHaveBeenCalled();
    expect(screen.getByText('Connect to a backend to read its process registry.')).toBeTruthy();
  });
});
