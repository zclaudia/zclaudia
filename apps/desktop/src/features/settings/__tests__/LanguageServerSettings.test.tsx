import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { LanguageServersOverview } from '@zclaudia/shared/core/language-servers';
import { LanguageServerSettings } from '../LanguageServerSettings';

vi.mock('../../../services/api', () => ({
  getLanguageServers: vi.fn(),
  setLanguageServersEnabled: vi.fn(),
}));
vi.mock('../../../hooks/useSettingsTargetBackend', () => ({
  useSettingsTargetBackend: () => ({
    targetBackendId: 'local',
    isLocalTarget: true,
    targetBackendName: 'This Device',
  }),
}));
import { getLanguageServers, setLanguageServersEnabled } from '../../../services/api';

const overview = (enabled: boolean): LanguageServersOverview => ({
  enabled,
  servers: enabled
    ? [
        {
          id: 'typescript',
          name: 'TypeScript',
          languages: ['typescript'],
          root: '/Users/me/code/app',
          state: 'ready',
          leases: 1,
          openDocuments: 3,
          pid: 1,
          startedAt: 1,
          lastUsedAt: 1,
          lastError: null,
          installHint: null,
        },
        {
          id: 'gopls',
          name: 'Go (gopls)',
          languages: ['go'],
          root: '/Users/me/code/svc',
          state: 'missing',
          leases: 0,
          openDocuments: 0,
          pid: null,
          startedAt: null,
          lastUsedAt: null,
          lastError: null,
          installHint: 'go install golang.org/x/tools/gopls@latest',
        },
      ]
    : [],
});

beforeEach(() => {
  vi.mocked(getLanguageServers).mockReset().mockResolvedValue(overview(true));
  vi.mocked(setLanguageServersEnabled).mockReset().mockResolvedValue(overview(false));
});

describe('LanguageServerSettings', () => {
  it('lists running servers by workspace and turns them all off', async () => {
    render(<LanguageServerSettings />);
    const list = await screen.findByTestId('language-server-list');
    expect(list).toHaveTextContent('TypeScript');
    expect(list).toHaveTextContent('app');
    expect(list).toHaveTextContent('Ready · 3 open');
    expect(list).toHaveTextContent('Go (gopls)');
    expect(list).toHaveTextContent('Not installed');
    expect(list).toHaveTextContent('go install golang.org/x/tools/gopls@latest');
    // Opening re-probes, so a server installed a moment ago shows up.
    expect(getLanguageServers).toHaveBeenCalledWith('local', { refresh: true });

    fireEvent.click(screen.getByRole('switch', { name: 'Language servers' }));
    await waitFor(() => expect(setLanguageServersEnabled).toHaveBeenCalledWith(false, 'local'));
    await waitFor(() => expect(screen.queryByTestId('language-server-list')).toBeNull());
  });
});
