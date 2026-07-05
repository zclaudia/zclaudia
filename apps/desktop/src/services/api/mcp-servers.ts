import type { McpServerConfig, McpServerStatus } from '@zclaudia/shared';
import type {
  McpOAuthConfig,
  McpOAuthCredentials,
  McpServerTransport,
  McpServerTrustPolicy,
} from '@zclaudia/shared/core/mcp';
import { fetchLocalApi, fetchApiForBackend } from './base';

export type McpOAuthStartResult =
  | { sessionId: string; method: 'browser'; authUrl: string; expiresAt: number }
  | {
      sessionId: string;
      method: 'device_code';
      userCode: string;
      verificationUri: string;
      expiresAt: number;
    };

export type McpOAuthStatus =
  | { state: 'pending' }
  | { state: 'success' }
  | { state: 'error'; code: string; message: string }
  | { state: 'cancelled' };

export async function getMcpServers(): Promise<McpServerConfig[]> {
  const result = await fetchLocalApi<McpServerConfig[]>('/api/mcp-servers');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch MCP servers');
  }
  return result.data;
}

export async function getMcpServersForBackend(
  backendId: string | null
): Promise<McpServerConfig[]> {
  const result = await fetchApiForBackend<McpServerConfig[]>('/api/mcp-servers', backendId);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch MCP servers');
  }
  return result.data;
}

export async function createMcpServer(config: {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  transport?: McpServerTransport;
  url?: string;
  headers?: Record<string, string>;
  headersHelper?: string;
  oauthConfig?: McpOAuthConfig;
  oauthCredentials?: McpOAuthCredentials;
  enabled?: boolean;
  description?: string;
  providerScope?: string[];
  trustPolicy?: McpServerTrustPolicy;
}): Promise<McpServerConfig> {
  const result = await fetchLocalApi<McpServerConfig>('/api/mcp-servers', {
    method: 'POST',
    body: JSON.stringify(config),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to create MCP server');
  }
  return result.data;
}

export async function updateMcpServer(
  id: string,
  config: Partial<{
    name: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    transport: McpServerTransport;
    url: string;
    headers: Record<string, string>;
    headersHelper: string;
    oauthConfig: McpOAuthConfig;
    oauthCredentials: McpOAuthCredentials | null;
    enabled: boolean;
    description: string;
    providerScope: string[];
    trustPolicy: McpServerTrustPolicy;
  }>
): Promise<McpServerConfig> {
  const result = await fetchLocalApi<McpServerConfig>(`/api/mcp-servers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to update MCP server');
  }
  return result.data;
}

export async function deleteMcpServer(id: string): Promise<void> {
  const result = await fetchLocalApi<null>(`/api/mcp-servers/${id}`, {
    method: 'DELETE',
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to delete MCP server');
  }
}

export async function toggleMcpServer(id: string): Promise<McpServerConfig> {
  const result = await fetchLocalApi<McpServerConfig>(`/api/mcp-servers/${id}/toggle`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to toggle MCP server');
  }
  return result.data;
}

export async function getMcpServerStatuses(): Promise<McpServerStatus[]> {
  const result = await fetchLocalApi<McpServerStatus[]>('/api/mcp-servers/status');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch MCP server status');
  }
  return result.data;
}

export async function getMcpServerStatusesForBackend(
  backendId: string | null
): Promise<McpServerStatus[]> {
  const result = await fetchApiForBackend<McpServerStatus[]>('/api/mcp-servers/status', backendId);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch MCP server status');
  }
  return result.data;
}

export async function connectMcpServer(name: string): Promise<McpServerStatus> {
  const result = await fetchLocalApi<McpServerStatus>(
    `/api/mcp-servers/${encodeURIComponent(name)}/connect`,
    {
      method: 'POST',
    }
  );
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to connect MCP server');
  }
  return result.data;
}

export async function disconnectMcpServer(name: string): Promise<McpServerStatus> {
  const result = await fetchLocalApi<McpServerStatus>(
    `/api/mcp-servers/${encodeURIComponent(name)}/disconnect`,
    {
      method: 'POST',
    }
  );
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to disconnect MCP server');
  }
  return result.data;
}

export async function refreshMcpServer(name: string): Promise<McpServerStatus> {
  const result = await fetchLocalApi<McpServerStatus>(
    `/api/mcp-servers/${encodeURIComponent(name)}/refresh`,
    {
      method: 'POST',
    }
  );
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to refresh MCP server');
  }
  return result.data;
}

export async function startMcpOAuth(
  name: string,
  method: 'browser' | 'device_code'
): Promise<McpOAuthStartResult> {
  const result = await fetchLocalApi<McpOAuthStartResult>(
    `/api/mcp-servers/${encodeURIComponent(name)}/oauth/start`,
    {
      method: 'POST',
      body: JSON.stringify({ method }),
    }
  );
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to start MCP OAuth');
  }
  return result.data;
}

export async function pollMcpOAuthStatus(name: string, sessionId: string): Promise<McpOAuthStatus> {
  const result = await fetchLocalApi<McpOAuthStatus>(
    `/api/mcp-servers/${encodeURIComponent(name)}/oauth/status/${encodeURIComponent(sessionId)}`
  );
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to poll MCP OAuth');
  }
  return result.data;
}

export async function cancelMcpOAuth(name: string, sessionId: string): Promise<void> {
  const result = await fetchLocalApi<{ ok: boolean }>(
    `/api/mcp-servers/${encodeURIComponent(name)}/oauth/cancel/${encodeURIComponent(sessionId)}`,
    {
      method: 'POST',
    }
  );
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to cancel MCP OAuth');
  }
}

export async function signOutMcpOAuth(name: string): Promise<void> {
  const result = await fetchLocalApi<{ ok: boolean }>(
    `/api/mcp-servers/${encodeURIComponent(name)}/oauth/signout`,
    {
      method: 'POST',
    }
  );
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to sign out MCP OAuth');
  }
}
