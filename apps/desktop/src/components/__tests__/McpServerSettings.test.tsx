import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { McpServerSettings } from '../../features/settings/McpServerSettings';
import { useMcpServerStore } from '../../stores/mcpServerStore';

describe('McpServerSettings', () => {
  const mockFetchServers = vi.fn();
  const mockAddServer = vi.fn();
  const mockEditServer = vi.fn();
  const mockRemoveServer = vi.fn();
  const mockToggle = vi.fn();
  const mockFetchStatuses = vi.fn();
  const mockConnect = vi.fn();
  const mockDisconnect = vi.fn();
  const mockRefresh = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchServers.mockResolvedValue(undefined);
    mockAddServer.mockResolvedValue({ id: 'new-1' });
    mockEditServer.mockResolvedValue(undefined);
    mockRemoveServer.mockResolvedValue(undefined);
    mockToggle.mockResolvedValue(undefined);
    mockFetchStatuses.mockResolvedValue(undefined);
    mockConnect.mockResolvedValue(undefined);
    mockDisconnect.mockResolvedValue(undefined);
    mockRefresh.mockResolvedValue(undefined);

    useMcpServerStore.setState({
      servers: [],
      statuses: {},
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      fetchStatuses: mockFetchStatuses,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
      connect: mockConnect,
      disconnect: mockDisconnect,
      refresh: mockRefresh,
    } as any);
  });

  it('renders empty state when no servers', () => {
    const { container } = render(<McpServerSettings />);
    expect(container.textContent).toContain('No MCP servers configured');
  });

  it('renders loading state when loading with no servers', () => {
    useMcpServerStore.setState({
      servers: [],
      isLoading: true,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
    } as any);

    render(<McpServerSettings />);
    expect(screen.getByText('Loading MCP servers...')).toBeTruthy();
  });

  it('calls fetchServers on mount', () => {
    render(<McpServerSettings />);
    expect(mockFetchServers).toHaveBeenCalled();
    expect(mockFetchStatuses).toHaveBeenCalled();
  });

  it('shows lifecycle status, inventory counts, and refresh action', () => {
    useMcpServerStore.setState({
      servers: [
        {
          id: 'mcp-1',
          name: 'GitHub',
          command: 'npx',
          args: ['github-mcp'],
          enabled: true,
        },
      ],
      statuses: {
        GitHub: {
          name: 'GitHub',
          state: 'connected',
          enabled: true,
          inventory: { tools: 2, resources: 3, prompts: 1 },
        },
      },
    } as any);

    render(<McpServerSettings />);
    expect(screen.getByText('connected')).toBeTruthy();
    expect(screen.getByText('Tools: 2')).toBeTruthy();
    expect(screen.getByText('Resources: 3')).toBeTruthy();
    expect(screen.getByText('Prompts: 1')).toBeTruthy();

    fireEvent.click(screen.getByText('Refresh'));
    expect(mockRefresh).toHaveBeenCalledWith('GitHub');
  });

  it('shows auth-required guidance and authenticate action for needs-auth MCP server', () => {
    useMcpServerStore.setState({
      servers: [
        {
          id: 'mcp-1',
          name: 'GitHub',
          command: 'npx',
          args: ['github-mcp'],
          enabled: true,
        },
      ],
      statuses: {
        GitHub: {
          name: 'GitHub',
          state: 'needs-auth',
          enabled: true,
          authRequired: true,
          authMessage: 'Authentication required for GitHub MCP.',
          lastError: '401 Unauthorized',
        },
      },
    } as any);

    render(<McpServerSettings />);

    expect(screen.getByText('needs-auth')).toBeTruthy();
    expect(screen.getByText('Authentication required for GitHub MCP.')).toBeTruthy();
    expect(
      screen.getByText('Update credentials, then authenticate to refresh this MCP server.')
    ).toBeTruthy();

    fireEvent.click(screen.getByText('Authenticate'));
    expect(mockRefresh).toHaveBeenCalledWith('GitHub');
  });

  it('shows OAuth login action for remote OAuth MCP server', () => {
    useMcpServerStore.setState({
      servers: [
        {
          id: 'mcp-1',
          name: 'RemoteGitHub',
          command: '',
          transport: 'streamable-http',
          url: 'https://mcp.example.com/mcp',
          enabled: true,
          oauthConfig: {
            enabled: true,
            authorizationEndpoint: 'https://auth.example.com/oauth/authorize',
            tokenEndpoint: 'https://auth.example.com/oauth/token',
            clientId: 'zclaudia-client',
            scopes: ['repo'],
          },
        },
      ],
      statuses: {
        RemoteGitHub: { name: 'RemoteGitHub', state: 'needs-auth', authRequired: true },
      },
    } as any);

    render(<McpServerSettings />);

    expect(screen.getByText('streamable-http')).toBeTruthy();
    expect(screen.getByText('https://mcp.example.com/mcp')).toBeTruthy();
    expect(screen.getByText('OAuth Login')).toBeTruthy();
  });

  it('shows OAuth credential status for remote MCP servers without exposing tokens', () => {
    useMcpServerStore.setState({
      servers: [
        {
          id: 'mcp-1',
          name: 'AuthenticatedRemote',
          command: '',
          transport: 'streamable-http',
          url: 'https://mcp.example.com/mcp',
          enabled: true,
          oauthConfig: { enabled: true, tokenEndpoint: 'https://auth.example.com/token' },
          oauthCredentials: {
            tokenType: 'Bearer',
            hasAccessToken: true,
            hasRefreshToken: true,
            expiresAt: Date.now() + 2 * 60 * 60 * 1000,
            scope: 'repo read:user',
          },
        },
        {
          id: 'mcp-2',
          name: 'ExpiredRemote',
          command: '',
          transport: 'streamable-http',
          url: 'https://mcp-expired.example.com/mcp',
          enabled: true,
          oauthConfig: { enabled: true, tokenEndpoint: 'https://auth.example.com/token' },
          oauthCredentials: {
            tokenType: 'Bearer',
            hasAccessToken: true,
            expiresAt: Date.now() - 1000,
          },
        },
      ],
      statuses: {},
    } as any);

    render(<McpServerSettings />);

    expect(screen.getByText('OAuth: authenticated')).toBeTruthy();
    expect(screen.getByText('OAuth: expired')).toBeTruthy();
    expect(screen.getByText('Scopes: repo read:user')).toBeTruthy();
    expect(document.body.textContent).not.toContain('secret-access-token');
    expect(document.body.textContent).not.toContain('secret-refresh-token');
  });

  it('expands server inventory drilldown with searchable tools, resources, and prompts', () => {
    useMcpServerStore.setState({
      servers: [
        {
          id: 'mcp-1',
          name: 'GitHub',
          command: 'npx',
          args: ['github-mcp'],
          enabled: true,
        },
      ],
      statuses: {
        GitHub: {
          name: 'GitHub',
          state: 'connected',
          enabled: true,
          inventory: { tools: 1, resources: 1, prompts: 1, cachedAt: 1234 },
          inventoryDetail: {
            tools: [
              {
                name: 'read_issue',
                description: 'Read an issue',
                inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
                annotations: { readOnlyHint: true },
                permissionSummary: {
                  declaredReadOnly: true,
                  trustedReadOnly: false,
                  mutatesWorkspace: false,
                  requiresNetwork: true,
                  riskLevel: 'medium',
                  providerTrust: 'untrusted',
                  advisory: 'MCP annotations are self-declared.',
                },
              },
            ],
            resources: [{ uri: 'file://readme', name: 'README', mimeType: 'text/markdown' }],
            prompts: [
              {
                name: 'summarize',
                description: 'Summarize content',
                arguments: [{ name: 'topic', required: true }],
              },
            ],
          },
        },
      },
    } as any);

    render(<McpServerSettings />);
    fireEvent.click(screen.getByText('Inventory details'));

    expect(screen.getByPlaceholderText('Search inventory...')).toBeTruthy();
    expect(screen.getByText('read_issue')).toBeTruthy();
    expect(screen.getByText('Risk: medium')).toBeTruthy();
    expect(screen.getByText('Readonly: declared, untrusted')).toBeTruthy();
    expect(screen.getByText('file://readme')).toBeTruthy();
    expect(screen.getByText('summarize')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Search inventory...'), {
      target: { value: 'readme' },
    });
    expect(screen.queryByText('read_issue')).toBeNull();
    expect(screen.getByText('file://readme')).toBeTruthy();
  });

  it('renders servers list', () => {
    useMcpServerStore.setState({
      servers: [
        {
          id: 'mcp-1',
          name: 'Test Server',
          command: 'npx',
          args: ['-y', 'test-server'],
          enabled: true,
        },
      ],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
    } as any);

    render(<McpServerSettings />);
    expect(screen.getByText('Test Server')).toBeTruthy();
    // "Enabled" appears both in the stats bar and as a server badge
    expect(screen.getAllByText('Enabled').length).toBeGreaterThanOrEqual(1);
  });

  it('renders disabled server badge', () => {
    useMcpServerStore.setState({
      servers: [
        {
          id: 'mcp-1',
          name: 'Disabled Server',
          command: 'npx',
          args: [],
          enabled: false,
        },
      ],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
    } as any);

    render(<McpServerSettings />);
    // "Disabled" appears both in the stats bar and as a server badge
    expect(screen.getAllByText('Disabled').length).toBeGreaterThanOrEqual(1);
  });

  it('shows server command with args', () => {
    useMcpServerStore.setState({
      servers: [
        {
          id: 'mcp-1',
          name: 'FS Server',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem'],
          enabled: true,
        },
      ],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
    } as any);

    render(<McpServerSettings />);
    expect(screen.getByText('npx -y @modelcontextprotocol/server-filesystem')).toBeTruthy();
  });

  it('shows description when present', () => {
    useMcpServerStore.setState({
      servers: [
        {
          id: 'mcp-1',
          name: 'Server',
          command: 'npx',
          args: [],
          enabled: true,
          description: 'A test server description',
        },
      ],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
    } as any);

    render(<McpServerSettings />);
    expect(screen.getByText('A test server description')).toBeTruthy();
  });

  it('shows provider scope badges', () => {
    useMcpServerStore.setState({
      servers: [
        {
          id: 'mcp-1',
          name: 'Server',
          command: 'npx',
          args: [],
          enabled: true,
          providerScope: ['zclaudia'],
        },
      ],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
    } as any);

    render(<McpServerSettings />);
    expect(screen.getByText('zclaudia')).toBeTruthy();
  });

  it('shows imported badge for imported servers', () => {
    useMcpServerStore.setState({
      servers: [
        {
          id: 'mcp-1',
          name: 'Imported Server',
          command: 'npx',
          args: [],
          enabled: true,
          source: 'imported',
        },
      ],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
    } as any);

    render(<McpServerSettings />);
    expect(screen.getByText('Imported')).toBeTruthy();
  });

  it('displays stats correctly', () => {
    useMcpServerStore.setState({
      servers: [
        { id: '1', name: 'S1', command: 'cmd', args: [], enabled: true },
        { id: '2', name: 'S2', command: 'cmd', args: [], enabled: true },
        { id: '3', name: 'S3', command: 'cmd', args: [], enabled: false },
      ],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
    } as any);

    const { container } = render(<McpServerSettings />);
    expect(container.textContent).toContain('3'); // Total
    expect(container.textContent).toContain('2'); // Enabled
    expect(container.textContent).toContain('1'); // Disabled
  });

  it('shows error message when error exists', () => {
    useMcpServerStore.setState({
      servers: [{ id: '1', name: 'S1', command: 'cmd', args: [], enabled: true }],
      isLoading: false,
      error: 'Failed to fetch servers',
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
    } as any);

    render(<McpServerSettings />);
    expect(screen.getByText('Failed to fetch servers')).toBeTruthy();
  });

  it('opens add form when + Add is clicked', () => {
    render(<McpServerSettings />);
    fireEvent.click(screen.getByText('+ Add'));
    expect(screen.getByPlaceholderText('e.g. filesystem')).toBeTruthy();
    expect(screen.getByPlaceholderText('e.g. npx')).toBeTruthy();
  });

  it('cancels add form', () => {
    render(<McpServerSettings />);
    fireEvent.click(screen.getByText('+ Add'));
    expect(screen.getByPlaceholderText('e.g. filesystem')).toBeTruthy();

    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByPlaceholderText('e.g. filesystem')).toBeNull();
  });

  it('shows validation error when submitting empty form', async () => {
    render(<McpServerSettings />);
    fireEvent.click(screen.getByText('+ Add'));
    fireEvent.click(screen.getByText('Add'));

    await waitFor(() => {
      expect(screen.getByText('Name and command are required')).toBeTruthy();
    });
  });

  it('submits add form with valid data', async () => {
    render(<McpServerSettings />);
    fireEvent.click(screen.getByText('+ Add'));

    fireEvent.change(screen.getByPlaceholderText('e.g. filesystem'), {
      target: { value: 'my-server' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. npx'), {
      target: { value: 'npx' },
    });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. -y/), {
      target: { value: '-y @test/server' },
    });

    fireEvent.click(screen.getByText('Add'));

    await waitFor(() => {
      expect(mockAddServer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'my-server',
          command: 'npx',
          args: ['-y', '@test/server'],
        })
      );
    });
  });

  it('submits remote MCP OAuth config', async () => {
    render(<McpServerSettings />);
    fireEvent.click(screen.getByText('+ Add'));

    fireEvent.change(screen.getByPlaceholderText('e.g. filesystem'), {
      target: { value: 'remote-github' },
    });
    fireEvent.change(screen.getByLabelText('Transport'), {
      target: { value: 'streamable-http' },
    });
    fireEvent.change(screen.getByPlaceholderText('https://mcp.example.com/mcp'), {
      target: { value: 'https://mcp.example.com/mcp' },
    });
    fireEvent.click(screen.getByLabelText('Enable OAuth'));
    fireEvent.change(screen.getByPlaceholderText('https://auth.example.com/oauth/authorize'), {
      target: { value: 'https://auth.example.com/oauth/authorize' },
    });
    fireEvent.change(screen.getByPlaceholderText('https://auth.example.com/oauth/token'), {
      target: { value: 'https://auth.example.com/oauth/token' },
    });
    fireEvent.change(screen.getByPlaceholderText('zclaudia-client-id'), {
      target: { value: 'zclaudia-client' },
    });
    fireEvent.change(screen.getByPlaceholderText('repo read:user'), {
      target: { value: 'repo read:user' },
    });

    fireEvent.click(screen.getByText('Add'));

    await waitFor(() => {
      expect(mockAddServer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'remote-github',
          command: '',
          transport: 'streamable-http',
          url: 'https://mcp.example.com/mcp',
          oauthConfig: expect.objectContaining({
            enabled: true,
            authorizationEndpoint: 'https://auth.example.com/oauth/authorize',
            tokenEndpoint: 'https://auth.example.com/oauth/token',
            clientId: 'zclaudia-client',
            scopes: ['repo', 'read:user'],
          }),
        })
      );
    });
  });

  it('submits add form with description', async () => {
    render(<McpServerSettings />);
    fireEvent.click(screen.getByText('+ Add'));

    fireEvent.change(screen.getByPlaceholderText('e.g. filesystem'), {
      target: { value: 'test' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. npx'), {
      target: { value: 'cmd' },
    });
    fireEvent.change(screen.getByPlaceholderText('Optional description'), {
      target: { value: 'My description' },
    });

    fireEvent.click(screen.getByText('Add'));

    await waitFor(() => {
      expect(mockAddServer).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'My description',
        })
      );
    });
  });

  it('can add and remove environment variables', () => {
    render(<McpServerSettings />);
    fireEvent.click(screen.getByText('+ Add'));

    // Click "+ Add" for env vars (the one in the form, after "Environment Variables" label)
    const envVarsLabel = screen.getByText('Environment Variables');
    const addEnvBtn = envVarsLabel.closest('div')?.querySelector('button');
    expect(addEnvBtn).toBeTruthy();
    fireEvent.click(addEnvBtn!);

    expect(screen.getByPlaceholderText('KEY')).toBeTruthy();
    expect(screen.getByPlaceholderText('value')).toBeTruthy();

    // Remove env var using aria-label
    fireEvent.click(screen.getByLabelText('Remove environment variable'));
    expect(screen.queryByPlaceholderText('KEY')).toBeNull();
  });

  it('can toggle provider scope', () => {
    render(<McpServerSettings />);
    fireEvent.click(screen.getByText('+ Add'));

    // The only provider scope option post-cleanup is ZClaudia
    fireEvent.click(screen.getByText('ZClaudia'));
    // Click again to deselect
    fireEvent.click(screen.getByText('ZClaudia'));
  });

  it('calls toggle when toggle button is clicked', () => {
    useMcpServerStore.setState({
      servers: [
        {
          id: 'mcp-1',
          name: 'Server',
          command: 'cmd',
          args: [],
          enabled: true,
        },
      ],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
    } as any);

    render(<McpServerSettings />);
    const toggleBtn = screen.getByTitle('Disable');
    fireEvent.click(toggleBtn);
    expect(mockToggle).toHaveBeenCalledWith('mcp-1');
  });

  it('opens edit form when edit button is clicked', () => {
    useMcpServerStore.setState({
      servers: [
        {
          id: 'mcp-1',
          name: 'Editable Server',
          command: 'npx',
          args: ['-y', 'test'],
          enabled: true,
          description: 'Some desc',
          providerScope: ['claude'],
        },
      ],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
    } as any);

    render(<McpServerSettings />);
    fireEvent.click(screen.getByTitle('Edit'));

    // Form should be populated with server data
    const nameInput = screen.getByPlaceholderText('e.g. filesystem') as HTMLInputElement;
    expect(nameInput.value).toBe('Editable Server');

    const cmdInput = screen.getByPlaceholderText('e.g. npx') as HTMLInputElement;
    expect(cmdInput.value).toBe('npx');

    // Save button should show "Save" instead of "Add"
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('submits edit form', async () => {
    useMcpServerStore.setState({
      servers: [
        {
          id: 'mcp-1',
          name: 'Server',
          command: 'cmd',
          args: [],
          enabled: true,
        },
      ],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
    } as any);

    render(<McpServerSettings />);
    fireEvent.click(screen.getByTitle('Edit'));

    fireEvent.change(screen.getByPlaceholderText('e.g. filesystem'), {
      target: { value: 'Updated Server' },
    });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockEditServer).toHaveBeenCalledWith(
        'mcp-1',
        expect.objectContaining({ name: 'Updated Server' })
      );
    });
  });

  it('edits MCP trust policy controls', async () => {
    useMcpServerStore.setState({
      servers: [
        {
          id: 'mcp-1',
          name: 'Trust Server',
          command: 'npx',
          args: [],
          enabled: true,
          trustPolicy: {
            trustLevel: 'untrusted',
            trustReadOnlyHint: false,
            defaultRiskAction: 'ask',
            riskActions: {},
          },
        },
      ],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
    } as any);

    render(<McpServerSettings />);
    fireEvent.click(screen.getByTitle('Edit'));
    fireEvent.change(screen.getByLabelText('Trust Level'), {
      target: { value: 'trusted-readonly' },
    });
    fireEvent.click(screen.getByLabelText('Trust read-only hints'));
    fireEvent.change(screen.getByLabelText('High risk action'), { target: { value: 'deny' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockEditServer).toHaveBeenCalledWith(
        'mcp-1',
        expect.objectContaining({
          trustPolicy: {
            trustLevel: 'trusted-readonly',
            trustReadOnlyHint: true,
            defaultRiskAction: 'ask',
            riskActions: { high: 'deny' },
          },
        })
      );
    });
  });

  it('handles delete with confirm', () => {
    useMcpServerStore.setState({
      servers: [
        {
          id: 'mcp-1',
          name: 'To Delete',
          command: 'cmd',
          args: [],
          enabled: true,
        },
      ],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
    } as any);

    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    );

    render(<McpServerSettings />);
    fireEvent.click(screen.getByTitle('Delete'));

    expect(mockRemoveServer).toHaveBeenCalledWith('mcp-1');
  });

  it('does not delete when confirm is cancelled', () => {
    useMcpServerStore.setState({
      servers: [
        {
          id: 'mcp-1',
          name: 'Keep Me',
          command: 'cmd',
          args: [],
          enabled: true,
        },
      ],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
    } as any);

    vi.stubGlobal(
      'confirm',
      vi.fn(() => false)
    );

    render(<McpServerSettings />);
    fireEvent.click(screen.getByTitle('Delete'));

    expect(mockRemoveServer).not.toHaveBeenCalled();
  });

  it('filters servers by search query', () => {
    useMcpServerStore.setState({
      servers: [
        { id: '1', name: 'Filesystem', command: 'npx', args: [], enabled: true },
        { id: '2', name: 'Database', command: 'node', args: [], enabled: true },
      ],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
    } as any);

    render(<McpServerSettings />);
    fireEvent.change(screen.getByPlaceholderText('Search MCP servers...'), {
      target: { value: 'file' },
    });

    expect(screen.getByText('Filesystem')).toBeTruthy();
    expect(screen.queryByText('Database')).toBeNull();
  });

  it('shows no match message when search has no results', () => {
    useMcpServerStore.setState({
      servers: [{ id: '1', name: 'Server', command: 'cmd', args: [], enabled: true }],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
    } as any);

    render(<McpServerSettings />);
    fireEvent.change(screen.getByPlaceholderText('Search MCP servers...'), {
      target: { value: 'nonexistent' },
    });

    expect(screen.getByText('No servers match your search')).toBeTruthy();
  });

  it('searches by command as well', () => {
    useMcpServerStore.setState({
      servers: [
        { id: '1', name: 'Server A', command: 'npx', args: [], enabled: true },
        { id: '2', name: 'Server B', command: 'docker', args: [], enabled: true },
      ],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
    } as any);

    render(<McpServerSettings />);
    fireEvent.change(screen.getByPlaceholderText('Search MCP servers...'), {
      target: { value: 'docker' },
    });

    expect(screen.queryByText('Server A')).toBeNull();
    expect(screen.getByText('Server B')).toBeTruthy();
  });
});
