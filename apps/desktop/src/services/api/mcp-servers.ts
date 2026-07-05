import type { McpServerConfig, McpServerStatus } from '@zclaudia/shared';
import type {
  McpOAuthConfig,
  McpOAuthCredentials,
  McpServerTransport,
  McpServerTrustPolicy,
} from '@zclaudia/shared/core/mcp';
import { fetchApiForBackend } from './base';

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

export async function getMcpServersForBackend(
  backendId: string | null
): Promise<McpServerConfig[]> {
  const result = await fetchApiForBackend<McpServerConfig[]>('/api/mcp-servers', backendId);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch MCP servers');
  }
  return result.data;
}

export async function createMcpServerForBackend(
  backendId: string | null,
  config: {
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
  }
): Promise<McpServerConfig> {
  const result = await fetchApiForBackend<McpServerConfig>('/api/mcp-servers', backendId, {
    method: 'POST',
    body: JSON.stringify(config),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to create MCP server');
  }
  return result.data;
}

export async function updateMcpServerForBackend(
  backendId: string | null,
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
  const result = await fetchApiForBackend<McpServerConfig>(`/api/mcp-servers/${id}`, backendId, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to update MCP server');
  }
  return result.data;
}

export async function deleteMcpServerForBackend(
  backendId: string | null,
  id: string
): Promise<void> {
  const result = await fetchApiForBackend<null>(`/api/mcp-servers/${id}`, backendId, {
    method: 'DELETE',
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to delete MCP server');
  }
}

export async function toggleMcpServerForBackend(
  backendId: string | null,
  id: string
): Promise<McpServerConfig> {
  const result = await fetchApiForBackend<McpServerConfig>(
    `/api/mcp-servers/${id}/toggle`,
    backendId,
    {
      method: 'POST',
    }
  );
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to toggle MCP server');
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

export async function connectMcpServerForBackend(
  backendId: string | null,
  name: string
): Promise<McpServerStatus> {
  const result = await fetchApiForBackend<McpServerStatus>(
    `/api/mcp-servers/${encodeURIComponent(name)}/connect`,
    backendId,
    {
      method: 'POST',
    }
  );
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to connect MCP server');
  }
  return result.data;
}

export async function disconnectMcpServerForBackend(
  backendId: string | null,
  name: string
): Promise<McpServerStatus> {
  const result = await fetchApiForBackend<McpServerStatus>(
    `/api/mcp-servers/${encodeURIComponent(name)}/disconnect`,
    backendId,
    {
      method: 'POST',
    }
  );
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to disconnect MCP server');
  }
  return result.data;
}

export async function refreshMcpServerForBackend(
  backendId: string | null,
  name: string
): Promise<McpServerStatus> {
  const result = await fetchApiForBackend<McpServerStatus>(
    `/api/mcp-servers/${encodeURIComponent(name)}/refresh`,
    backendId,
    {
      method: 'POST',
    }
  );
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to refresh MCP server');
  }
  return result.data;
}

export async function startMcpOAuthForBackend(
  backendId: string | null,
  name: string,
  method: 'browser' | 'device_code'
): Promise<McpOAuthStartResult> {
  const result = await fetchApiForBackend<McpOAuthStartResult>(
    `/api/mcp-servers/${encodeURIComponent(name)}/oauth/start`,
    backendId,
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

export async function pollMcpOAuthStatusForBackend(
  backendId: string | null,
  name: string,
  sessionId: string
): Promise<McpOAuthStatus> {
  const result = await fetchApiForBackend<McpOAuthStatus>(
    `/api/mcp-servers/${encodeURIComponent(name)}/oauth/status/${encodeURIComponent(sessionId)}`,
    backendId
  );
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to poll MCP OAuth');
  }
  return result.data;
}

export async function cancelMcpOAuthForBackend(
  backendId: string | null,
  name: string,
  sessionId: string
): Promise<void> {
  const result = await fetchApiForBackend<{ ok: boolean }>(
    `/api/mcp-servers/${encodeURIComponent(name)}/oauth/cancel/${encodeURIComponent(sessionId)}`,
    backendId,
    {
      method: 'POST',
    }
  );
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to cancel MCP OAuth');
  }
}

export async function signOutMcpOAuthForBackend(
  backendId: string | null,
  name: string
): Promise<void> {
  const result = await fetchApiForBackend<{ ok: boolean }>(
    `/api/mcp-servers/${encodeURIComponent(name)}/oauth/signout`,
    backendId,
    {
      method: 'POST',
    }
  );
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to sign out MCP OAuth');
  }
}
