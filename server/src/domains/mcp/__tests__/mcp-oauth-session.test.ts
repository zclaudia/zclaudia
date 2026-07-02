import { describe, expect, it, vi } from 'vitest';
import { McpOAuthSessionManager } from '../mcp-oauth-session.js';
import type { McpServerConfig } from '@zclaudia/shared/core/mcp';

function serverWithOAuth(oauthConfig: McpServerConfig['oauthConfig']): McpServerConfig {
  return {
    id: 's1',
    name: 'remote',
    command: '',
    transport: 'streamable-http',
    url: 'https://mcp.example.com/mcp',
    oauthConfig,
    enabled: true,
    source: 'user',
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('McpOAuthSessionManager', () => {
  it('discovers OAuth authorization and token endpoints from metadataUrl before browser flow', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        authorization_endpoint: 'https://auth.example.com/oauth/authorize',
        token_endpoint: 'https://auth.example.com/oauth/token',
      }),
      text: async () => '',
    });
    const manager = new McpOAuthSessionManager(
      { updateOAuthCredentials: vi.fn() },
      fetchMock as any
    );

    const result = await manager.startBrowserFlow(
      serverWithOAuth({
        enabled: true,
        metadataUrl: 'https://auth.example.com/.well-known/oauth-authorization-server',
        clientId: 'client',
        scopes: ['repo'],
      } as any),
      'http://127.0.0.1:4141'
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example.com/.well-known/oauth-authorization-server',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result.method).toBe('browser');
    const authUrl = new URL(result.authUrl);
    expect(authUrl.origin + authUrl.pathname).toBe('https://auth.example.com/oauth/authorize');
    expect(authUrl.searchParams.get('client_id')).toBe('client');
    expect(authUrl.searchParams.get('scope')).toBe('repo');
  });

  it('discovers OAuth device and token endpoints from metadataUrl before device-code flow', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token_endpoint: 'https://auth.example.com/oauth/token',
          device_authorization_endpoint: 'https://auth.example.com/oauth/device',
        }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          device_code: 'device-code',
          user_code: 'USER-CODE',
          verification_uri: 'https://auth.example.com/device',
          expires_in: 600,
          interval: 5,
        }),
        text: async () => '',
      });
    const manager = new McpOAuthSessionManager(
      { updateOAuthCredentials: vi.fn() },
      fetchMock as any
    );

    const result = await manager.startDeviceCodeFlow(
      serverWithOAuth({
        enabled: true,
        metadataUrl: 'https://auth.example.com/.well-known/oauth-authorization-server',
        clientId: 'client',
      } as any)
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://auth.example.com/.well-known/oauth-authorization-server',
      expect.objectContaining({ method: 'GET' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://auth.example.com/oauth/device',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result).toEqual(
      expect.objectContaining({
        method: 'device_code',
        userCode: 'USER-CODE',
        verificationUri: 'https://auth.example.com/device',
      })
    );
  });
});
