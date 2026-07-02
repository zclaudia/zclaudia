import { beforeEach, describe, expect, it, vi } from 'vitest';

const clientConnectMock = vi.fn();
const streamableTransportCtorMock = vi.fn();
const sseTransportCtorMock = vi.fn();
const streamableTransportCloseMock = vi.fn();
const sseTransportCloseMock = vi.fn();

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class MockClient {
    connect = clientConnectMock;
    getInstructions = () => undefined;
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTPClientTransport {
    close = streamableTransportCloseMock;
    constructor(...args: unknown[]) {
      streamableTransportCtorMock(...args);
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class MockSSEClientTransport {
    close = sseTransportCloseMock;
    constructor(...args: unknown[]) {
      sseTransportCtorMock(...args);
    }
  },
}));

describe('RemoteMcpClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
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

    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example.com/oauth/token',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(URLSearchParams),
      })
    );
    const tokenRequestBody = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(tokenRequestBody.get('grant_type')).toBe('refresh_token');
    expect(tokenRequestBody.get('refresh_token')).toBe('old-refresh-token');
    expect(onOAuthCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'fresh-access-token',
        refreshToken: 'fresh-refresh-token',
        tokenType: 'Bearer',
        scope: 'repo',
      })
    );
    expect(streamableTransportCtorMock).toHaveBeenCalledWith(
      new URL('https://mcp.example.com/mcp'),
      expect.objectContaining({
        requestInit: {
          headers: expect.objectContaining({
            Authorization: 'Bearer fresh-access-token',
          }),
        },
      })
    );
    expect(clientConnectMock).toHaveBeenCalledTimes(1);
  });

  it('clears stored OAuth credentials when refresh fails with invalid grant', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant', error_description: 'refresh token expired' }),
      text: async () =>
        JSON.stringify({ error: 'invalid_grant', error_description: 'refresh token expired' }),
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

  it('discovers OAuth token endpoint from metadataUrl before refreshing credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token_endpoint: 'https://auth.example.com/oauth/token',
        }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'fresh-access-token',
          refresh_token: 'fresh-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
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
        metadataUrl: 'https://auth.example.com/.well-known/oauth-authorization-server',
        clientId: 'client-id',
      } as any,
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

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://auth.example.com/.well-known/oauth-authorization-server',
      expect.objectContaining({ method: 'GET' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://auth.example.com/oauth/token',
      expect.objectContaining({ method: 'POST' })
    );
    expect(onOAuthCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'fresh-access-token',
        refreshToken: 'fresh-refresh-token',
      })
    );
  });

  it('times out remote MCP connection attempts and closes the transport', async () => {
    vi.useFakeTimers();
    clientConnectMock.mockImplementationOnce(() => new Promise(() => undefined));
    const { RemoteMcpClient } = await import('../mcp-remote-client.js');

    const client = new RemoteMcpClient({
      transport: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      connectTimeoutMs: 100,
    } as any);

    const connectPromise = expect(client.connect()).rejects.toThrow(
      'Remote MCP connection timed out after 100ms'
    );
    await vi.advanceTimersByTimeAsync(100);

    await connectPromise;
    expect(streamableTransportCloseMock).toHaveBeenCalledTimes(1);
    expect(client.isConnected).toBe(false);
  });

  it('passes a per-request timeout fetch to remote MCP transports', async () => {
    vi.useFakeTimers();
    const neverFetch = vi.fn(
      (_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    const { RemoteMcpClient } = await import('../mcp-remote-client.js');

    const client = new RemoteMcpClient({
      transport: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      fetchFn: neverFetch as any,
      requestTimeoutMs: 250,
    } as any);

    await client.connect();
    const transportOptions = streamableTransportCtorMock.mock.calls[0][1] as {
      fetch?: typeof fetch;
    };
    expect(transportOptions.fetch).toEqual(expect.any(Function));

    const requestPromise = expect(
      transportOptions.fetch!('https://mcp.example.com/mcp', { method: 'POST' })
    ).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(250);
    await requestPromise;
    expect(neverFetch).toHaveBeenCalledWith(
      'https://mcp.example.com/mcp',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('executes headersHelper before connect and lets dynamic headers override static headers', async () => {
    const headersHelperRunner = vi.fn().mockResolvedValue({
      Authorization: 'Bearer dynamic-token',
      'X-Dynamic': 'yes',
    });
    const { RemoteMcpClient } = await import('../mcp-remote-client.js');

    const client = new RemoteMcpClient({
      transport: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      headers: {
        Authorization: 'Bearer static-token',
        'X-Static': 'yes',
      },
      headersHelper: 'node ./headers-helper.js',
      headersHelperRunner,
    } as any);

    await client.connect();

    expect(headersHelperRunner).toHaveBeenCalledWith('node ./headers-helper.js', {
      serverName: undefined,
      url: 'https://mcp.example.com/mcp',
    });
    expect(streamableTransportCtorMock).toHaveBeenCalledWith(
      new URL('https://mcp.example.com/mcp'),
      expect.objectContaining({
        requestInit: {
          headers: {
            Authorization: 'Bearer dynamic-token',
            'X-Static': 'yes',
            'X-Dynamic': 'yes',
          },
        },
      })
    );
  });
});
