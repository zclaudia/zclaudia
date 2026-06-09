import { beforeEach, describe, expect, it, vi } from 'vitest';

const clientConnectMock = vi.fn();
const streamableTransportCtorMock = vi.fn();
const sseTransportCtorMock = vi.fn();

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class MockClient {
    connect = clientConnectMock;
    getInstructions = () => undefined;
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTPClientTransport {
    close = vi.fn();
    constructor(...args: unknown[]) {
      streamableTransportCtorMock(...args);
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class MockSSEClientTransport {
    close = vi.fn();
    constructor(...args: unknown[]) {
      sseTransportCtorMock(...args);
    }
  },
}));

describe('RemoteMcpClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refreshes expired OAuth credentials before connecting and persists rotated credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'fresh-access-token',
        refresh_token: 'fresh-refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'repo',
      }),
      text: async () => '',
    });
    const onOAuthCredentials = vi.fn();
    const { RemoteMcpClient } = await import('../mcp-remote-client.js');

    const client = new RemoteMcpClient({
      transport: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      oauthConfig: {
        enabled: true,
        tokenEndpoint: 'https://auth.example.com/oauth/token',
        clientId: 'client-id',
      },
      oauthCredentials: {
        accessToken: 'expired-access-token',
        refreshToken: 'old-refresh-token',
        tokenType: 'Bearer',
        expiresAt: Date.now() - 1000,
      },
      fetchFn: fetchMock,
      onOAuthCredentials,
    } as any);

    await client.connect();

    expect(fetchMock).toHaveBeenCalledWith('https://auth.example.com/oauth/token', expect.objectContaining({
      method: 'POST',
      body: expect.any(URLSearchParams),
    }));
    const tokenRequestBody = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(tokenRequestBody.get('grant_type')).toBe('refresh_token');
    expect(tokenRequestBody.get('refresh_token')).toBe('old-refresh-token');
    expect(onOAuthCredentials).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'fresh-access-token',
      refreshToken: 'fresh-refresh-token',
      tokenType: 'Bearer',
      scope: 'repo',
    }));
    expect(streamableTransportCtorMock).toHaveBeenCalledWith(
      new URL('https://mcp.example.com/mcp'),
      expect.objectContaining({
        requestInit: {
          headers: expect.objectContaining({
            Authorization: 'Bearer fresh-access-token',
          }),
        },
      }),
    );
    expect(clientConnectMock).toHaveBeenCalledTimes(1);
  });

  it('clears stored OAuth credentials when refresh fails with invalid grant', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant', error_description: 'refresh token expired' }),
      text: async () => JSON.stringify({ error: 'invalid_grant', error_description: 'refresh token expired' }),
    });
    const onOAuthCredentials = vi.fn();
    const { RemoteMcpClient } = await import('../mcp-remote-client.js');

    const client = new RemoteMcpClient({
      transport: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      oauthConfig: {
        enabled: true,
        tokenEndpoint: 'https://auth.example.com/oauth/token',
        clientId: 'client-id',
      },
      oauthCredentials: {
        accessToken: 'expired-access-token',
        refreshToken: 'expired-refresh-token',
        tokenType: 'Bearer',
        expiresAt: Date.now() - 1000,
      },
      fetchFn: fetchMock,
      onOAuthCredentials,
    } as any);

    await expect(client.connect()).rejects.toThrow('OAuth refresh failed');
    expect(onOAuthCredentials).toHaveBeenCalledWith(null);
    expect(streamableTransportCtorMock).not.toHaveBeenCalled();
  });
});
