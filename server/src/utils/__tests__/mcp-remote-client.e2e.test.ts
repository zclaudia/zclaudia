import { afterEach, describe, expect, it, vi } from 'vitest';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { RemoteMcpClient } from '../mcp-remote-client.js';

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : undefined;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

function handleRpcMessage(body: { id?: unknown; method?: string }): unknown {
  if (body.id === undefined || body.id === null) return null;
  if (body.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: body.id,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'local-e2e', version: '1.0.0' },
      },
    };
  }
  if (body.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: body.id,
      result: {
        tools: [
          {
            name: 'ping',
            description: 'Ping tool',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      },
    };
  }
  return {
    jsonrpc: '2.0',
    id: body.id,
    error: { code: -32601, message: 'Method not found' },
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: () => string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message())), ms);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

describe('RemoteMcpClient OAuth E2E', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    for (const server of servers) {
      server.closeAllConnections();
    }
    await Promise.all(
      servers.map(server => new Promise<void>(resolve => server.close(() => resolve())))
    );
    servers.length = 0;
  });

  it('refreshes an expired OAuth token then connects to a local streamable-http MCP server', async () => {
    const observedAuthHeaders: string[] = [];
    const observedMethods: string[] = [];
    const app = http.createServer(async (req, res) => {
      if (req.url === '/oauth/token' && req.method === 'POST') {
        sendJson(res, 200, {
          access_token: 'fresh-e2e-token',
          refresh_token: 'rotated-e2e-refresh',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'repo',
        });
        return;
      }
      if (req.url?.startsWith('/mcp')) {
        observedAuthHeaders.push(String(req.headers.authorization || ''));
        if (req.headers.authorization !== 'Bearer fresh-e2e-token') {
          sendJson(res, 401, { error: 'unauthorized' });
          return;
        }
        if (req.method === 'GET') {
          res.writeHead(405);
          res.end();
          return;
        }
        const body =
          req.method === 'POST'
            ? ((await readJson(req)) as
                | { id?: unknown; method?: string }
                | Array<{ id?: unknown; method?: string }>)
            : undefined;
        for (const item of Array.isArray(body) ? body : body ? [body] : []) {
          observedMethods.push(`${req.method} ${item.method ?? 'notification'}`);
        }
        const result = Array.isArray(body)
          ? body.map(handleRpcMessage).filter(Boolean)
          : body
            ? handleRpcMessage(body)
            : null;
        if (!result || (Array.isArray(result) && result.length === 0)) {
          res.writeHead(202);
          res.end();
          return;
        }
        sendJson(res, 200, result);
        return;
      }
      sendJson(res, 404, { error: 'not_found' });
    });
    servers.push(app);
    await new Promise<void>(resolve => app.listen(0, '127.0.0.1', () => resolve()));
    const address = app.address();
    if (!address || typeof address === 'string')
      throw new Error('failed to bind local test server');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const onOAuthCredentials = vi.fn();

    const client = new RemoteMcpClient({
      transport: 'streamable-http',
      url: `${baseUrl}/mcp`,
      oauthConfig: {
        enabled: true,
        tokenEndpoint: `${baseUrl}/oauth/token`,
        clientId: 'local-client',
      },
      oauthCredentials: {
        accessToken: 'expired-e2e-token',
        refreshToken: 'old-e2e-refresh',
        tokenType: 'Bearer',
        expiresAt: Date.now() - 1,
      },
      onOAuthCredentials,
    });

    await withTimeout(
      client.connect(),
      2000,
      () => `connect timed out: ${observedMethods.join(', ')}`
    );
    const tools = await client.listTools();

    expect(observedAuthHeaders).toContain('Bearer fresh-e2e-token');
    expect(onOAuthCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'fresh-e2e-token',
        refreshToken: 'rotated-e2e-refresh',
      })
    );
    expect(tools).toEqual([expect.objectContaining({ name: 'ping', description: 'Ping tool' })]);
    await client.disconnect();
  });
});
