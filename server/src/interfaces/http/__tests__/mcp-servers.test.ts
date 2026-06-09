import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createMcpServerRoutes } from '../mcp-servers.js';
import { mcpClientManager } from '../../../utils/mcp-client-manager.js';
import { mcpInventoryCache } from '../../../utils/mcp-inventory-cache.js';

describe('mcp-servers routes', () => {
  let app: express.Express;
  let db: Database.Database;

  beforeEach(() => {
    mcpInventoryCache.invalidate();
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        command TEXT NOT NULL,
        args TEXT,
        env TEXT,
        enabled INTEGER DEFAULT 1,
        description TEXT,
        source TEXT DEFAULT 'user',
        provider_scope TEXT,
        trust_policy TEXT,
        transport TEXT,
        url TEXT,
        headers TEXT,
        oauth_config TEXT,
        oauth_credentials TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )
    `);

    app = express();
    app.use(express.json());
    app.use('/api/mcp-servers', createMcpServerRoutes(db));
  });

  afterEach(() => {
    db.close();
  });

  describe('GET /api/mcp-servers', () => {
    it('returns empty list initially', async () => {
      const res = await request(app).get('/api/mcp-servers');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it('returns created servers', async () => {
      db.prepare(`
        INSERT INTO mcp_servers (id, name, command, args, env, enabled, source, created_at, updated_at)
        VALUES ('s1', 'test', 'node', '["server.js"]', '{"PORT":"3000"}', 1, 'user', 1000, 1000)
      `).run();

      const res = await request(app).get('/api/mcp-servers');
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('test');
      expect(res.body.data[0].args).toEqual(['server.js']);
      expect(res.body.data[0].env).toEqual({ PORT: '3000' });
      expect(res.body.data[0].enabled).toBe(true);
    });

    it('redacts OAuth access and refresh tokens from list and status responses', async () => {
      db.prepare(`
        INSERT INTO mcp_servers (
          id, name, command, enabled, source, transport, url, oauth_config, oauth_credentials, created_at, updated_at
        )
        VALUES ('s1', 'remote', '', 1, 'user', 'streamable-http', 'https://mcp.example.com/mcp', ?, ?, 1000, 1000)
      `).run(
        JSON.stringify({
          enabled: true,
          authorizationEndpoint: 'https://auth.example.com/oauth/authorize',
          tokenEndpoint: 'https://auth.example.com/oauth/token',
          clientId: 'client',
        }),
        JSON.stringify({
          accessToken: 'secret-access-token',
          refreshToken: 'secret-refresh-token',
          tokenType: 'Bearer',
          expiresAt: 2000,
          scope: 'repo',
        }),
      );

      const list = await request(app).get('/api/mcp-servers');
      const status = await request(app).get('/api/mcp-servers/status');

      expect(list.status).toBe(200);
      expect(list.body.data[0].oauthCredentials).toEqual({
        tokenType: 'Bearer',
        expiresAt: 2000,
        scope: 'repo',
        hasAccessToken: true,
        hasRefreshToken: true,
      });
      expect(JSON.stringify(list.body)).not.toContain('secret-access-token');
      expect(JSON.stringify(list.body)).not.toContain('secret-refresh-token');
      expect(JSON.stringify(status.body)).not.toContain('secret-access-token');
      expect(JSON.stringify(status.body)).not.toContain('secret-refresh-token');
    });
  });

  describe('POST /api/mcp-servers', () => {
    it('creates a new server', async () => {
      const res = await request(app)
        .post('/api/mcp-servers')
        .send({ name: 'my-server', command: 'python', args: ['run.py'] });
      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('my-server');
      expect(res.body.data.command).toBe('python');
      expect(res.body.data.enabled).toBe(true);
    });

    it('returns 400 without name', async () => {
      const res = await request(app)
        .post('/api/mcp-servers')
        .send({ command: 'node' });
      expect(res.status).toBe(400);
    });

    it('returns 400 without command', async () => {
      const res = await request(app)
        .post('/api/mcp-servers')
        .send({ name: 'test' });
      expect(res.status).toBe(400);
    });

    it('returns 409 for duplicate name', async () => {
      await request(app)
        .post('/api/mcp-servers')
        .send({ name: 'my-server', command: 'node' });
      const res = await request(app)
        .post('/api/mcp-servers')
        .send({ name: 'my-server', command: 'python' });
      expect(res.status).toBe(409);
    });

    it('creates with env and description', async () => {
      const res = await request(app)
        .post('/api/mcp-servers')
        .send({
          name: 'srv',
          command: 'node',
          env: { KEY: 'val' },
          description: 'Test server',
          providerScope: ['claude'],
        });
      expect(res.status).toBe(201);
      expect(res.body.data.env).toEqual({ KEY: 'val' });
      expect(res.body.data.description).toBe('Test server');
      expect(res.body.data.providerScope).toEqual(['claude']);
    });
  });

  describe('PUT /api/mcp-servers/:id', () => {
    it('updates an existing server', async () => {
      const create = await request(app)
        .post('/api/mcp-servers')
        .send({ name: 'srv', command: 'node' });
      const id = create.body.data.id;

      const res = await request(app)
        .put(`/api/mcp-servers/${id}`)
        .send({ name: 'updated-srv', command: 'python' });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('updated-srv');
      expect(res.body.data.command).toBe('python');
    });

    it('returns 404 for non-existent server', async () => {
      const res = await request(app)
        .put('/api/mcp-servers/nonexistent')
        .send({ name: 'test' });
      expect(res.status).toBe(404);
    });

    it('returns 409 for duplicate name', async () => {
      await request(app).post('/api/mcp-servers').send({ name: 'srv1', command: 'node' });
      const create2 = await request(app).post('/api/mcp-servers').send({ name: 'srv2', command: 'node' });
      const id2 = create2.body.data.id;

      const res = await request(app)
        .put(`/api/mcp-servers/${id2}`)
        .send({ name: 'srv1' });
      expect(res.status).toBe(409);
    });
  });

  describe('DELETE /api/mcp-servers/:id', () => {
    it('deletes an existing server', async () => {
      const create = await request(app)
        .post('/api/mcp-servers')
        .send({ name: 'srv', command: 'node' });
      const id = create.body.data.id;

      const res = await request(app).delete(`/api/mcp-servers/${id}`);
      expect(res.status).toBe(200);

      // Verify deleted
      const list = await request(app).get('/api/mcp-servers');
      expect(list.body.data).toHaveLength(0);
    });

    it('returns 404 for non-existent server', async () => {
      const res = await request(app).delete('/api/mcp-servers/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/mcp-servers/:id/toggle', () => {
    it('toggles enabled state', async () => {
      const create = await request(app)
        .post('/api/mcp-servers')
        .send({ name: 'srv', command: 'node' });
      const id = create.body.data.id;
      expect(create.body.data.enabled).toBe(true);

      const res = await request(app).post(`/api/mcp-servers/${id}/toggle`);
      expect(res.status).toBe(200);
      expect(res.body.data.enabled).toBe(false);

      const res2 = await request(app).post(`/api/mcp-servers/${id}/toggle`);
      expect(res2.body.data.enabled).toBe(true);
    });

    it('returns 404 for non-existent server', async () => {
      const res = await request(app).post('/api/mcp-servers/nonexistent/toggle');
      expect(res.status).toBe(404);
    });
  });

  describe('lifecycle status endpoints', () => {
    it('lists configured, disabled, and connected server status', async () => {
      db.prepare(`
        INSERT INTO mcp_servers (id, name, command, enabled, source, created_at, updated_at)
        VALUES ('s1', 'connected-server', 'node', 1, 'user', 1000, 1000),
               ('s2', 'disabled-server', 'node', 0, 'user', 1000, 1000)
      `).run();
      vi.spyOn(mcpClientManager, 'getStatus').mockImplementation((name: string) => (
        name === 'connected-server'
          ? { name, state: 'connected', lastConnectedAt: 1234 }
          : { name, state: 'configured' }
      ) as any);

      const res = await request(app).get('/api/mcp-servers/status');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        expect.objectContaining({ name: 'connected-server', state: 'connected', enabled: true }),
        expect.objectContaining({ name: 'disabled-server', state: 'disabled', enabled: false }),
      ]);
    });

    it('connects, disconnects, and refreshes a server by name', async () => {
      db.prepare(`
        INSERT INTO mcp_servers (id, name, command, args, env, enabled, source, created_at, updated_at)
        VALUES ('s1', 'srv', 'node', '["server.js"]', '{"A":"1"}', 1, 'user', 1000, 1000)
      `).run();
      vi.spyOn(mcpClientManager, 'connect').mockResolvedValue(undefined as any);
      vi.spyOn(mcpClientManager, 'disconnect').mockResolvedValue(undefined as any);
      vi.spyOn(mcpClientManager, 'refresh').mockResolvedValue(undefined as any);
      vi.spyOn(mcpClientManager, 'listTools').mockResolvedValue([]);
      vi.spyOn(mcpClientManager, 'listResources').mockResolvedValue([]);
      vi.spyOn(mcpClientManager, 'listPrompts').mockResolvedValue([]);
      vi.spyOn(mcpClientManager, 'getStatus').mockReturnValue({ name: 'srv', state: 'connected' } as any);

      await expect(request(app).post('/api/mcp-servers/srv/connect')).resolves.toMatchObject({ status: 200 });
      await expect(request(app).post('/api/mcp-servers/srv/disconnect')).resolves.toMatchObject({ status: 200 });
      await expect(request(app).post('/api/mcp-servers/srv/refresh')).resolves.toMatchObject({ status: 200 });
      expect(mcpClientManager.connect).toHaveBeenCalledWith('srv', { transport: 'stdio', command: 'node', args: ['server.js'], env: { A: '1' } });
      expect(mcpClientManager.disconnect).toHaveBeenCalledWith('srv');
      expect(mcpClientManager.refresh).toHaveBeenCalledWith('srv', { transport: 'stdio', command: 'node', args: ['server.js'], env: { A: '1' } });
    });

    it('passes OAuth persistence callback when refreshing remote MCP servers', async () => {
      db.prepare(`
        INSERT INTO mcp_servers (
          id, name, command, enabled, source, transport, url, oauth_config, oauth_credentials, created_at, updated_at
        )
        VALUES ('s1', 'remote', '', 1, 'user', 'streamable-http', 'https://mcp.example.com/mcp', ?, ?, 1000, 1000)
      `).run(
        JSON.stringify({ enabled: true, tokenEndpoint: 'https://auth.example.com/token', clientId: 'client' }),
        JSON.stringify({ accessToken: 'old-token', refreshToken: 'refresh-token', tokenType: 'Bearer', expiresAt: 1 }),
      );
      vi.spyOn(mcpClientManager, 'refresh').mockResolvedValue(undefined as any);
      vi.spyOn(mcpClientManager, 'listTools').mockResolvedValue([]);
      vi.spyOn(mcpClientManager, 'listResources').mockResolvedValue([]);
      vi.spyOn(mcpClientManager, 'listPrompts').mockResolvedValue([]);
      vi.spyOn(mcpClientManager, 'getStatus').mockReturnValue({ name: 'remote', state: 'connected' } as any);

      const res = await request(app).post('/api/mcp-servers/remote/refresh');

      expect(res.status).toBe(200);
      expect(mcpClientManager.refresh).toHaveBeenCalledWith('remote', expect.objectContaining({
        transport: 'streamable-http',
        url: 'https://mcp.example.com/mcp',
        oauthConfig: expect.objectContaining({ tokenEndpoint: 'https://auth.example.com/token' }),
        oauthCredentials: expect.objectContaining({ accessToken: 'old-token' }),
        onOAuthCredentials: expect.any(Function),
      }));

      const config = vi.mocked(mcpClientManager.refresh).mock.calls[0][1] as any;
      config.onOAuthCredentials({ accessToken: 'fresh-token', tokenType: 'Bearer' });
      const row = db.prepare('SELECT oauth_credentials FROM mcp_servers WHERE name = ?').get('remote') as { oauth_credentials: string };
      expect(JSON.parse(row.oauth_credentials)).toEqual(expect.objectContaining({ accessToken: 'fresh-token' }));
    });

    it('returns cached inventory details with tool risk metadata after refresh', async () => {
      db.prepare(`
        INSERT INTO mcp_servers (id, name, command, args, env, enabled, source, created_at, updated_at)
        VALUES ('s1', 'srv', 'node', '["server.js"]', '{"A":"1"}', 1, 'user', 1000, 1000)
      `).run();
      vi.spyOn(mcpClientManager, 'refresh').mockResolvedValue(undefined as any);
      vi.spyOn(mcpClientManager, 'listTools').mockResolvedValue([
        {
          name: 'read_issue',
          description: 'Read an issue',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
          annotations: { readOnlyHint: true },
        } as any,
      ]);
      vi.spyOn(mcpClientManager, 'listResources').mockResolvedValue([
        { uri: 'file://readme', name: 'README', description: 'Project readme', mimeType: 'text/markdown' },
      ]);
      vi.spyOn(mcpClientManager, 'listPrompts').mockResolvedValue([
        { name: 'summarize', description: 'Summarize content', arguments: [{ name: 'topic', required: true }] },
      ]);
      vi.spyOn(mcpClientManager, 'getStatus').mockReturnValue({
        name: 'srv',
        state: 'connected',
        lastConnectedAt: 1234,
      } as any);

      const refresh = await request(app).post('/api/mcp-servers/srv/refresh');
      const status = await request(app).get('/api/mcp-servers/status');

      expect(refresh.status).toBe(200);
      expect(status.body.data[0]).toEqual(expect.objectContaining({
        name: 'srv',
        inventory: expect.objectContaining({ tools: 1, resources: 1, prompts: 1 }),
        inventoryDetail: {
          tools: [
            expect.objectContaining({
              name: 'read_issue',
              description: 'Read an issue',
              inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
              annotations: { readOnlyHint: true },
              permissionSummary: expect.objectContaining({
                declaredReadOnly: true,
                trustedReadOnly: false,
                requiresNetwork: true,
              }),
            }),
          ],
          resources: [
            expect.objectContaining({ uri: 'file://readme', name: 'README', mimeType: 'text/markdown' }),
          ],
          prompts: [
            expect.objectContaining({ name: 'summarize', arguments: [{ name: 'topic', required: true }] }),
          ],
        },
      }));
    });
  });

  describe('OAuth endpoints', () => {
    it('starts browser PKCE flow, handles callback, and persists MCP OAuth credentials', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'repo read:user',
        }),
        text: async () => '',
      } as any);
      db.prepare(`
        INSERT INTO mcp_servers (
          id, name, command, enabled, source, transport, url, oauth_config, created_at, updated_at
        )
        VALUES ('s1', 'remote', '', 1, 'user', 'streamable-http', 'https://mcp.example.com/mcp', ?, 1000, 1000)
      `).run(JSON.stringify({
        enabled: true,
        authorizationEndpoint: 'https://auth.example.com/oauth/authorize',
        tokenEndpoint: 'https://auth.example.com/oauth/token',
        clientId: 'zclaudia-client',
        scopes: ['repo', 'read:user'],
      }));

      const start = await request(app).post('/api/mcp-servers/remote/oauth/start').send({ method: 'browser' });
      expect(start.status).toBe(200);
      expect(start.body.data.method).toBe('browser');
      expect(start.body.data.authUrl).toContain('https://auth.example.com/oauth/authorize');
      expect(start.body.data.authUrl).toContain('code_challenge=');
      expect(start.body.data.authUrl).toContain('state=');

      const callback = await request(app)
        .get('/api/mcp-servers/oauth/callback')
        .query({ state: start.body.data.sessionId, code: 'auth-code' });
      expect(callback.status).toBe(200);
      expect(callback.text).toContain('MCP authentication complete');

      const row = db.prepare('SELECT oauth_credentials FROM mcp_servers WHERE name = ?').get('remote') as { oauth_credentials: string };
      expect(JSON.parse(row.oauth_credentials)).toEqual(expect.objectContaining({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        tokenType: 'Bearer',
        scope: 'repo read:user',
      }));
      expect(fetchMock).toHaveBeenCalledWith('https://auth.example.com/oauth/token', expect.objectContaining({
        method: 'POST',
      }));
    });

    it('starts device-code flow and persists credentials after token polling succeeds', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            device_code: 'device-code',
            user_code: 'ABCD-1234',
            verification_uri: 'https://auth.example.com/device',
            expires_in: 900,
            interval: 1,
          }),
          text: async () => '',
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'device-access-token',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
          text: async () => '',
        } as any);
      db.prepare(`
        INSERT INTO mcp_servers (
          id, name, command, enabled, source, transport, url, oauth_config, created_at, updated_at
        )
        VALUES ('s1', 'remote', '', 1, 'user', 'streamable-http', 'https://mcp.example.com/mcp', ?, 1000, 1000)
      `).run(JSON.stringify({
        enabled: true,
        tokenEndpoint: 'https://auth.example.com/oauth/token',
        deviceAuthorizationEndpoint: 'https://auth.example.com/oauth/device',
        clientId: 'zclaudia-client',
        scopes: ['repo'],
      }));

      const start = await request(app).post('/api/mcp-servers/remote/oauth/start').send({ method: 'device_code' });
      expect(start.status).toBe(200);
      expect(start.body.data).toEqual(expect.objectContaining({
        method: 'device_code',
        userCode: 'ABCD-1234',
        verificationUri: 'https://auth.example.com/device',
      }));

      await new Promise((resolve) => setTimeout(resolve, 20));
      const status = await request(app).get(`/api/mcp-servers/remote/oauth/status/${start.body.data.sessionId}`);
      expect(status.body.data.state).toBe('success');

      const row = db.prepare('SELECT oauth_credentials FROM mcp_servers WHERE name = ?').get('remote') as { oauth_credentials: string };
      expect(JSON.parse(row.oauth_credentials)).toEqual(expect.objectContaining({
        accessToken: 'device-access-token',
        tokenType: 'Bearer',
      }));
    });
  });

  describe('error handling - catch blocks', () => {
    it('GET /api/mcp-servers returns 500 on database error', async () => {
      const spy = vi.spyOn(db, 'prepare').mockImplementation(() => {
        throw new Error('DB error');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await request(app).get('/api/mcp-servers');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DB_ERROR');
      expect(res.body.error.message).toBe('Failed to list MCP servers');
      spy.mockRestore();
      errorSpy.mockRestore();
    });

    it('POST /api/mcp-servers returns 500 on database error during insert', async () => {
      let callCount = 0;
      const spy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        callCount++;
        // Let the SELECT for uniqueness check pass, then throw on INSERT
        if (callCount === 1) {
          return { get: vi.fn().mockReturnValue(undefined) } as any;
        }
        throw new Error('DB error');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await request(app)
        .post('/api/mcp-servers')
        .send({ name: 'fail-server', command: 'node' });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DB_ERROR');
      spy.mockRestore();
      errorSpy.mockRestore();
    });

    it('PUT /api/mcp-servers/:id returns 500 on database error', async () => {
      // First create a server normally
      const create = await request(app)
        .post('/api/mcp-servers')
        .send({ name: 'srv-err', command: 'node' });
      const id = create.body.data.id;

      // Now mock to throw
      const spy = vi.spyOn(db, 'prepare').mockImplementation(() => {
        throw new Error('DB error');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await request(app)
        .put(`/api/mcp-servers/${id}`)
        .send({ name: 'updated' });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DB_ERROR');
      spy.mockRestore();
      errorSpy.mockRestore();
    });

    it('DELETE /api/mcp-servers/:id returns 500 on database error', async () => {
      const spy = vi.spyOn(db, 'prepare').mockImplementation(() => {
        throw new Error('DB error');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await request(app).delete('/api/mcp-servers/some-id');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DB_ERROR');
      spy.mockRestore();
      errorSpy.mockRestore();
    });

    it('POST /api/mcp-servers/:id/toggle returns 500 on database error', async () => {
      const spy = vi.spyOn(db, 'prepare').mockImplementation(() => {
        throw new Error('DB error');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await request(app).post('/api/mcp-servers/some-id/toggle');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DB_ERROR');
      spy.mockRestore();
      errorSpy.mockRestore();
    });

  });

  describe('POST /api/mcp-servers - disabled creation', () => {
    it('creates a server with enabled=false', async () => {
      const res = await request(app)
        .post('/api/mcp-servers')
        .send({ name: 'disabled-srv', command: 'node', enabled: false });
      expect(res.status).toBe(201);
      expect(res.body.data.enabled).toBe(false);
    });
  });
});
