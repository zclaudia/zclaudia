import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockGetServerInfo = vi.fn();

vi.mock('../../../services/api', () => ({
  getServerInfo: (...args: unknown[]) => mockGetServerInfo(...args),
}));
vi.mock('../../../contexts/ConnectionContext', () => ({
  useConnection: () => ({ embeddedServerPort: 3100 }),
}));

import { AboutSettings } from '../AboutSettings';
import { useFacadeStore } from '../../../stores/facadeStore';

describe('AboutSettings', () => {
  beforeEach(() => {
    mockGetServerInfo.mockReset();
    mockGetServerInfo.mockResolvedValue({ sdkVersions: null });
    useFacadeStore.setState({ localBackendId: 'local-1', backends: [] } as any);
  });

  it('renders the About section with the app version', () => {
    render(<AboutSettings isOpen />);
    expect(screen.getByText('About')).toBeTruthy();
    expect(screen.getByText('Version')).toBeTruthy();
  });

  it('queries the local embedded server for SDK versions', async () => {
    mockGetServerInfo.mockResolvedValue({
      sdkVersions: {
        sdks: [{ name: '@anthropic/sdk', current: '1.0.0', latest: '1.1.0', outdated: true }],
      },
    });

    render(<AboutSettings isOpen />);

    await waitFor(() => expect(screen.getByText('@anthropic/sdk')).toBeTruthy());
    expect(mockGetServerInfo).toHaveBeenCalledWith('localhost:3100');
    expect(screen.getByText('1.0.0 → 1.1.0')).toBeTruthy();
  });

  it('skips the SDK check when no local backend is known', () => {
    useFacadeStore.setState({ localBackendId: null, backends: [] } as any);
    render(<AboutSettings isOpen />);
    expect(mockGetServerInfo).not.toHaveBeenCalled();
  });

  it('falls back to the backends list to detect the local backend', () => {
    useFacadeStore.setState({
      localBackendId: null,
      backends: [{ backendId: 'local-2', isThisInstance: true }],
    } as any);
    render(<AboutSettings isOpen />);
    expect(mockGetServerInfo).toHaveBeenCalledWith('localhost:3100');
  });
});
