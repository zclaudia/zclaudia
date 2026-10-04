import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { LanguageServersOverview } from '@zclaudia/shared/core/language-servers';
import { LanguageServerSettings } from '../LanguageServerSettings';

vi.mock('../../../services/api', () => ({
  getLanguageServers: vi.fn(),
  setLanguageServersEnabled: vi.fn(),
  getCustomLanguageServers: vi.fn(),
  setCustomLanguageServers: vi.fn(),
  allowPluginLanguageServers: vi.fn(),
}));
vi.mock('../../../hooks/useSettingsTargetBackend', () => ({
  useSettingsTargetBackend: () => ({
    targetBackendId: 'local',
    isLocalTarget: true,
    targetBackendName: 'This Device',
  }),
}));
import {
  allowPluginLanguageServers,
  getCustomLanguageServers,
  getLanguageServers,
  setCustomLanguageServers,
  setLanguageServersEnabled,
} from '../../../services/api';

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
          source: 'builtin',
          pluginId: null,
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
          source: 'builtin',
          pluginId: null,
        },
        {
          id: 'lua',
          name: 'Lua',
          languages: ['lua'],
          root: '/Users/me/code/game',
          state: 'needs_permission',
          leases: 0,
          openDocuments: 0,
          pid: null,
          startedAt: null,
          lastUsedAt: null,
          lastError: 'The plugin needs permission to run commands (shell.execute)',
          installHint: null,
          source: 'plugin',
          pluginId: 'com.example.lua',
        },
      ]
    : [],
});

beforeEach(() => {
  vi.mocked(getLanguageServers).mockReset().mockResolvedValue(overview(true));
  vi.mocked(setLanguageServersEnabled).mockReset().mockResolvedValue(overview(false));
  vi.mocked(getCustomLanguageServers).mockReset().mockResolvedValue({ servers: [] });
  vi.mocked(setCustomLanguageServers)
    .mockReset()
    .mockImplementation(async servers => ({ servers }));
  vi.mocked(allowPluginLanguageServers).mockReset().mockResolvedValue(undefined);
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

  it("lets a plugin's server run once the user allows it", async () => {
    render(<LanguageServerSettings />);
    const list = await screen.findByTestId('language-server-list');
    expect(list).toHaveTextContent('Lua');
    expect(list).toHaveTextContent('Plugin');
    expect(list).toHaveTextContent('Needs permission');
    fireEvent.click(screen.getByRole('button', { name: 'Allow plugin to run commands' }));
    await waitFor(() =>
      expect(allowPluginLanguageServers).toHaveBeenCalledWith('com.example.lua', 'local')
    );
    await waitFor(() => expect(getLanguageServers).toHaveBeenCalledTimes(2));
  });

  it('adds, edits and removes custom servers', async () => {
    render(<LanguageServerSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add server' }));
    const editor = screen.getByTestId('custom-server-editor');
    // Saving an empty form names the missing fields instead of calling the backend.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(editor).toHaveTextContent('Command is required');
    expect(setCustomLanguageServers).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'C (clangd)' } });
    expect(screen.getByLabelText(/^Id/)).toHaveValue('c-clangd');
    fireEvent.change(screen.getByLabelText(/^Command/), { target: { value: 'clangd' } });
    fireEvent.change(screen.getByLabelText(/^File extensions/), { target: { value: '.c .h=c' } });
    fireEvent.change(screen.getByLabelText(/^Root markers/), {
      target: { value: 'compile_commands.json' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const clangd = {
      id: 'c-clangd',
      name: 'C (clangd)',
      command: 'clangd',
      extensions: { '.c': 'c', '.h': 'c' },
      rootMarkers: ['compile_commands.json'],
    };
    await waitFor(() => expect(setCustomLanguageServers).toHaveBeenCalledWith([clangd], 'local'));
    const custom = await screen.findByTestId('custom-language-servers');
    expect(custom).toHaveTextContent('C (clangd)');

    fireEvent.click(screen.getByRole('button', { name: 'Edit C (clangd)' }));
    fireEvent.change(screen.getByLabelText(/^Arguments/), {
      target: { value: '--background-index' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(setCustomLanguageServers).toHaveBeenLastCalledWith(
        [{ ...clangd, args: ['--background-index'] }],
        'local'
      )
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Remove C (clangd)' }));
    await waitFor(() => expect(setCustomLanguageServers).toHaveBeenLastCalledWith([], 'local'));
  });
});
