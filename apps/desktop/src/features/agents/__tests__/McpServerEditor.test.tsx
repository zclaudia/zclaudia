// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { McpServerConfig } from '@zclaudia/shared';

import { McpServerEditor } from '../McpServerEditor';
import * as api from '../../../services/api';

vi.mock('../../../services/api', () => ({
  createMcpServerForBackend: vi.fn(),
  updateMcpServerForBackend: vi.fn(),
  deleteMcpServerForBackend: vi.fn(),
  toggleMcpServerForBackend: vi.fn(),
  connectMcpServerForBackend: vi.fn(),
  disconnectMcpServerForBackend: vi.fn(),
  refreshMcpServerForBackend: vi.fn(),
  startMcpOAuthForBackend: vi.fn(),
  signOutMcpOAuthForBackend: vi.fn(),
}));

vi.mock('../McpOAuthLoginModal', () => ({
  McpOAuthLoginModal: ({ serverName }: { serverName: string }) => (
    <div data-testid="oauth-modal">{serverName}</div>
  ),
}));

function makeServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 's1',
    name: 'filesystem',
    command: 'npx',
    args: ['-y', 'mcp-fs'],
    transport: 'stdio',
    enabled: true,
    source: 'user',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function renderEditor(server: McpServerConfig | null, overrides: Partial<McpServerConfig> = {}) {
  const resolved = server ? { ...server, ...overrides } : null;
  const onSaved = vi.fn();
  const onDeleted = vi.fn();
  const onStatusChanged = vi.fn();
  const view = render(
    <McpServerEditor
      backendId="b1"
      server={resolved}
      status={undefined}
      onSaved={onSaved}
      onDeleted={onDeleted}
      onStatusChanged={onStatusChanged}
    />
  );
  return { onSaved, onDeleted, onStatusChanged, ...view };
}

describe('McpServerEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'open').mockReturnValue(null);
    vi.mocked(api.createMcpServerForBackend).mockResolvedValue(makeServer({ id: 'created-1' }));
    vi.mocked(api.updateMcpServerForBackend).mockResolvedValue(makeServer());
    vi.mocked(api.startMcpOAuthForBackend).mockResolvedValue({
      sessionId: 'sess1',
      method: 'browser',
      authUrl: 'https://auth.example.com/authorize',
      expiresAt: 123,
    });
  });

  it('create mode: saves via createMcpServerForBackend and fires onSaved with the new id', async () => {
    const { onSaved } = renderEditor(null);

    fireEvent.change(screen.getByPlaceholderText('e.g. filesystem'), {
      target: { value: 'my-server' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. npx'), { target: { value: 'npx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(api.createMcpServerForBackend).toHaveBeenCalledWith('b1', {
        name: 'my-server',
        command: 'npx',
        transport: 'stdio',
        url: undefined,
        args: undefined,
        env: undefined,
        headers: undefined,
        headersHelper: undefined,
        oauthConfig: undefined,
        description: undefined,
        providerScope: undefined,
        trustPolicy: {
          trustLevel: 'untrusted',
          trustReadOnlyHint: false,
          defaultRiskAction: 'ask',
          riskActions: {},
        },
      });
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith('created-1');
    });
  });

  it('create mode: empty name shows a validation error and skips the api call', async () => {
    const { onSaved } = renderEditor(null);

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Name and command are required')).toBeInTheDocument();
    expect(api.createMcpServerForBackend).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('edit mode: populates the form from the server and updates via updateMcpServerForBackend', async () => {
    const { onSaved } = renderEditor(makeServer());

    expect(screen.getByDisplayValue('filesystem')).toBeInTheDocument();
    expect(screen.getByDisplayValue('npx')).toBeInTheDocument();
    expect(screen.getByDisplayValue('-y mcp-fs')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('filesystem'), {
      target: { value: 'renamed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(api.updateMcpServerForBackend).toHaveBeenCalledWith(
        'b1',
        's1',
        expect.objectContaining({
          name: 'renamed',
          command: 'npx',
          transport: 'stdio',
          args: ['-y', 'mcp-fs'],
        })
      );
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith('s1');
    });
  });

  it('edit mode: empty args/env/headers fall back to [] / {} / {} in the update payload', async () => {
    const { onSaved } = renderEditor(makeServer({ args: undefined }));

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(api.updateMcpServerForBackend).toHaveBeenCalledWith(
        'b1',
        's1',
        expect.objectContaining({ args: [], env: {}, headers: {} })
      );
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith('s1');
    });
  });

  it('delete: first click arms confirmation, second click deletes and fires onDeleted', async () => {
    const { onDeleted } = renderEditor(makeServer());

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.deleteMcpServerForBackend).not.toHaveBeenCalled();

    const confirmButton = await screen.findByRole('button', { name: 'Confirm delete' });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(api.deleteMcpServerForBackend).toHaveBeenCalledWith('b1', 's1');
    });
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalled();
    });
  });

  it('connect fires connectMcpServerForBackend and onStatusChanged', async () => {
    const { onStatusChanged } = renderEditor(makeServer());

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(api.connectMcpServerForBackend).toHaveBeenCalledWith('b1', 'filesystem');
    });
    await waitFor(() => {
      expect(onStatusChanged).toHaveBeenCalled();
    });
  });

  it('disconnect fires disconnectMcpServerForBackend and onStatusChanged', async () => {
    const { onStatusChanged } = renderEditor(makeServer());

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => {
      expect(api.disconnectMcpServerForBackend).toHaveBeenCalledWith('b1', 'filesystem');
    });
    await waitFor(() => {
      expect(onStatusChanged).toHaveBeenCalled();
    });
  });

  it('toggle fires toggleMcpServerForBackend with the server id and onStatusChanged', async () => {
    const { onStatusChanged } = renderEditor(makeServer());

    fireEvent.click(screen.getByRole('switch', { name: 'Disable' }));

    await waitFor(() => {
      expect(api.toggleMcpServerForBackend).toHaveBeenCalledWith('b1', 's1');
    });
    await waitFor(() => {
      expect(onStatusChanged).toHaveBeenCalled();
    });
  });

  it('disabled server hides connection actions but keeps the toggle', () => {
    renderEditor(makeServer({ enabled: false }));

    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Enable' })).toBeInTheDocument();
  });

  it('OAuth login button starts the flow for the backend and opens the modal', async () => {
    renderEditor(
      makeServer({
        transport: 'streamable-http',
        url: 'https://mcp.example.com/mcp',
        oauthConfig: { enabled: true },
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'OAuth Login' }));

    await waitFor(() => {
      expect(api.startMcpOAuthForBackend).toHaveBeenCalledWith('b1', 'filesystem', 'browser');
    });
    expect(await screen.findByTestId('oauth-modal')).toHaveTextContent('filesystem');
  });

  it('device login button only shows when a device endpoint is configured', () => {
    renderEditor(
      makeServer({
        transport: 'streamable-http',
        url: 'https://mcp.example.com/mcp',
        oauthConfig: {
          enabled: true,
          deviceAuthorizationEndpoint: 'https://auth.example.com/device',
        },
      })
    );

    expect(screen.getByRole('button', { name: 'Device Login' })).toBeInTheDocument();
  });

  it('sign out shows only with credentials and fires signOutMcpOAuthForBackend', async () => {
    const { onStatusChanged } = renderEditor(
      makeServer({
        transport: 'streamable-http',
        url: 'https://mcp.example.com/mcp',
        oauthConfig: { enabled: true },
        oauthCredentials: { hasAccessToken: true },
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => {
      expect(api.signOutMcpOAuthForBackend).toHaveBeenCalledWith('b1', 'filesystem');
    });
    await waitFor(() => {
      expect(onStatusChanged).toHaveBeenCalled();
    });
  });

  it('sign out is hidden without stored credentials', () => {
    renderEditor(
      makeServer({
        transport: 'streamable-http',
        url: 'https://mcp.example.com/mcp',
        oauthConfig: { enabled: true },
      })
    );

    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('every MCP text field is labeled', () => {
    const stdio = renderEditor(makeServer({ transport: 'stdio' }));
    ['Name', 'Command', 'Arguments', 'Description'].forEach(name => {
      expect(screen.getByLabelText(new RegExp(name, 'i'))).toBeTruthy();
    });
    stdio.unmount();

    renderEditor(
      makeServer({
        transport: 'streamable-http',
        url: 'https://mcp.example.com/mcp',
        oauthConfig: { enabled: true },
      })
    );
    expect(screen.getByLabelText(/Name/i)).toBeTruthy();
    expect(screen.getByLabelText(/Remote MCP URL/i)).toBeTruthy();
    expect(screen.getByLabelText(/Description/i)).toBeTruthy();
    expect(screen.getByLabelText(/^Metadata URL$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^Authorization Endpoint$/i)).toBeTruthy();
    expect(screen.getByLabelText(/Token Endpoint/i)).toBeTruthy();
    expect(screen.getByLabelText(/Device Authorization Endpoint/i)).toBeTruthy();
    expect(screen.getByLabelText(/Client ID/i)).toBeTruthy();
    expect(screen.getByLabelText(/Client Secret/i)).toBeTruthy();
    expect(screen.getByLabelText(/Scopes/i)).toBeTruthy();
  });

  it('shows an inline error when save fails', async () => {
    vi.mocked(api.updateMcpServerForBackend).mockRejectedValue(new Error('save boom'));

    const { onSaved } = renderEditor(makeServer());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('save boom')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
