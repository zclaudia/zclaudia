import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectMock = vi.fn();
const disconnectMock = vi.fn();
const callToolMock = vi.fn();
const listToolsMock = vi.fn();
const ctorMock = vi.fn();
const remoteCtorMock = vi.fn();
const remoteConnectMock = vi.fn();
const remoteDisconnectMock = vi.fn();
let mockInstructions: string | undefined;
let mockRemoteInstructions: string | undefined;

vi.mock('../mcp-client.js', () => ({
  McpClient: class MockMcpClient {
    isConnected = true;
    get instructions() {
      return mockInstructions;
    }

    constructor(...args: unknown[]) {
      ctorMock(...args);
    }

    connect = connectMock;
    disconnect = disconnectMock;
    callTool = callToolMock;
    listTools = listToolsMock;
  },
}));

vi.mock('../mcp-remote-client.js', () => ({
  RemoteMcpClient: class MockRemoteMcpClient {
    isConnected = true;
    get instructions() {
      return mockRemoteInstructions;
    }

    constructor(...args: unknown[]) {
      remoteCtorMock(...args);
    }

    connect = remoteConnectMock;
    disconnect = remoteDisconnectMock;
    callTool = callToolMock;
    listTools = listToolsMock;
  },
}));

describe('McpClientManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInstructions = undefined;
    mockRemoteInstructions = undefined;
  });

  it('reuses cached client when config is unchanged', async () => {
    const { McpClientManager } = await import('../mcp-client-manager.js');
    const manager = new McpClientManager();
    const config = { command: 'node', args: ['srv.js'], env: { A: '1' } };

    const first = await manager.getClient('test', config);
    const second = await manager.getClient('test', config);

    expect(first).toBe(second);
    expect(ctorMock).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it('recreates client when config changes for the same server name', async () => {
    const { McpClientManager } = await import('../mcp-client-manager.js');
    const manager = new McpClientManager();

    await manager.getClient('test', { command: 'node', args: ['srv.js'], env: { A: '1' } });
    await manager.getClient('test', { command: 'node', args: ['srv.js'], env: { A: '2' } });

    expect(ctorMock).toHaveBeenCalledTimes(2);
    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('tracks lifecycle status across connect and disconnect', async () => {
    const { McpClientManager } = await import('../mcp-client-manager.js');
    const manager = new McpClientManager();
    const config = { command: 'node', args: ['srv.js'] };

    expect(manager.getStatus('test').state).toBe('configured');
    await manager.connect('test', config);
    expect(manager.getStatus('test')).toEqual(expect.objectContaining({
      name: 'test',
      state: 'connected',
      lastConnectedAt: expect.any(Number),
    }));

    await manager.disconnect('test');
    expect(manager.getStatus('test')).toEqual(expect.objectContaining({
      name: 'test',
      state: 'idle-disconnected',
      lastDisconnectedAt: expect.any(Number),
    }));
  });

  it('reports failed status when connection fails', async () => {
    connectMock.mockRejectedValueOnce(new Error('boom'));
    const { McpClientManager } = await import('../mcp-client-manager.js');
    const manager = new McpClientManager();

    await expect(manager.connect('broken', { command: 'node' })).rejects.toThrow('boom');
    expect(manager.getStatus('broken')).toEqual(expect.objectContaining({
      name: 'broken',
      state: 'failed',
      lastError: 'boom',
    }));
  });

  it('reports needs-auth status when connection fails with unauthorized/auth-required error', async () => {
    connectMock.mockRejectedValueOnce(new Error('401 Unauthorized: authentication required'));
    const { McpClientManager } = await import('../mcp-client-manager.js');
    const manager = new McpClientManager();

    await expect(manager.connect('private-github', { command: 'node' })).rejects.toThrow('authentication required');
    expect(manager.getStatus('private-github')).toEqual(expect.objectContaining({
      name: 'private-github',
      state: 'needs-auth',
      lastError: '401 Unauthorized: authentication required',
      authRequired: true,
      authMessage: expect.stringContaining('authentication'),
    }));
  });

  it('exposes MCP server instructions metadata on connected status', async () => {
    mockInstructions = 'Use this server for GitHub operations.';
    const { McpClientManager } = await import('../mcp-client-manager.js');
    const manager = new McpClientManager();

    await manager.connect('github', { command: 'node' });

    expect(manager.getStatus('github')).toEqual(expect.objectContaining({
      name: 'github',
      state: 'connected',
      hasInstructions: true,
      instructions: 'Use this server for GitHub operations.',
    }));
  });

  it('uses remote MCP client for streamable-http servers with OAuth bearer token', async () => {
    mockRemoteInstructions = 'Use remote GitHub MCP.';
    const { McpClientManager } = await import('../mcp-client-manager.js');
    const manager = new McpClientManager();
    const onOAuthCredentials = vi.fn();

    await manager.connect('remote-github', {
      transport: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      headers: { 'X-Zoom-Region': 'us01' },
      oauthConfig: { enabled: true, tokenEndpoint: 'https://auth.example.com/token' },
      oauthCredentials: { accessToken: 'access-token', tokenType: 'Bearer' },
      onOAuthCredentials,
    } as any);

    expect(ctorMock).not.toHaveBeenCalled();
    expect(remoteCtorMock).toHaveBeenCalledWith(expect.objectContaining({
      serverName: 'remote-github',
      transport: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      headers: { 'X-Zoom-Region': 'us01' },
      oauthConfig: { enabled: true, tokenEndpoint: 'https://auth.example.com/token' },
      oauthCredentials: { accessToken: 'access-token', tokenType: 'Bearer' },
      onOAuthCredentials,
    }));
    expect(remoteConnectMock).toHaveBeenCalledTimes(1);
    expect(manager.getStatus('remote-github')).toEqual(expect.objectContaining({
      state: 'connected',
      hasInstructions: true,
      instructions: 'Use remote GitHub MCP.',
    }));
  });

  it('reconnects and retries once when a remote MCP session expires during tool call', async () => {
    const sessionExpired = Object.assign(
      new Error('Streamable HTTP error: Error POSTing to endpoint: {"error":{"code":-32001,"message":"Session not found"}}'),
      { code: 404 },
    );
    callToolMock
      .mockRejectedValueOnce(sessionExpired)
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'retried ok' }],
        isError: false,
      });
    const { McpClientManager } = await import('../mcp-client-manager.js');
    const manager = new McpClientManager();
    const config = {
      transport: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
    } as any;

    await manager.connect('remote-github', config);
    const result = await manager.callTool('remote-github', config, 'read_issue', { id: '1' });

    expect(result).toEqual({
      content: [{ type: 'text', text: 'retried ok' }],
      isError: false,
    });
    expect(callToolMock).toHaveBeenCalledTimes(2);
    expect(remoteCtorMock).toHaveBeenCalledTimes(2);
    expect(remoteConnectMock).toHaveBeenCalledTimes(2);
    expect(remoteDisconnectMock).toHaveBeenCalledTimes(1);
    expect(manager.getStatus('remote-github')).toEqual(expect.objectContaining({
      state: 'connected',
      lastError: undefined,
    }));
  });
});
