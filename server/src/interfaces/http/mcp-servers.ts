/**
 * MCP Server Management API Routes
 *
 * CRUD endpoints for managing Claudia's MCP server registry.
 * MCP servers configured here are injected into providers at run time.
 */

import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import type {
  McpOAuthCredentials,
  McpRiskAction,
  McpServerConfig,
  McpServerInventoryDetail,
  McpServerTrustPolicy,
} from '@zclaudia/shared/core/mcp';
import { normalizeMcpServerTrustPolicy } from '@zclaudia/shared/core/mcp';
import { resolveMcpServerStatus } from '@zclaudia/shared/core/record-status-resolvers';
import type { ApiResponse } from '@zclaudia/shared/core/api';
import type { ExternalToolRiskPolicy } from '@zclaudia/shared/core/tools';
import { mcpClientManager } from '../../utils/mcp-client-manager.js';
import { mcpInventoryCache } from '../../utils/mcp-inventory-cache.js';
import {
  McpServerService,
  McpServerServiceError,
  type McpServerRow,
} from '../../infra/services/mcp-server-service.js';
import { sendApiError } from './response.js';
import { McpOAuthSessionManager } from '../../domains/mcp/mcp-oauth-session.js';

// ── Routes ───────────────────────────────────────────────────

export function createMcpServerRoutes(db: Database.Database): Router {
  const router = Router();
  const mcpServerService = new McpServerService(db);
  const mcpOAuthSessions = new McpOAuthSessionManager({
    updateOAuthCredentials: (serverName, credentials) =>
      mcpServerService.updateOAuthCredentials(serverName, credentials),
  });

  function redactMcpServerForResponse(server: McpServerConfig): McpServerConfig {
    if (!server.oauthCredentials) return server;
    return {
      ...server,
      oauthCredentials: {
        tokenType: server.oauthCredentials.tokenType,
        expiresAt: server.oauthCredentials.expiresAt,
        scope: server.oauthCredentials.scope,
        hasAccessToken: !!server.oauthCredentials.accessToken,
        hasRefreshToken: !!server.oauthCredentials.refreshToken,
      } as McpServerConfig['oauthCredentials'],
    };
  }

  /**
   * GET /api/mcp-servers
   * List all MCP servers.
   */
  router.get('/', (_req: Request, res: Response) => {
    try {
      const data = mcpServerService.listServers().map(redactMcpServerForResponse);
      res.json({ success: true, data } as ApiResponse<McpServerConfig[]>);
    } catch (error) {
      console.error('[MCP Servers] Error listing:', error);
      sendApiError(res, 500, 'DB_ERROR', 'Failed to list MCP servers');
    }
  });

  router.get('/status', (_req: Request, res: Response) => {
    try {
      const servers = mcpServerService.listServers();
      const data = servers.map(server => {
        const status = statusWithInventory(server);
        const state = server.enabled ? status.state : 'disabled';
        const hasEndpoint =
          (server.transport ?? 'stdio') === 'stdio' ? Boolean(server.command) : Boolean(server.url);
        return {
          ...status,
          enabled: server.enabled,
          state,
          recordStatus: resolveMcpServerStatus({
            hasEndpoint,
            enabled: server.enabled,
            connectionState: status.state,
          }),
        };
      });
      res.json({ success: true, data });
    } catch (error) {
      console.error('[MCP Servers] Error listing status:', error);
      sendApiError(res, 500, 'DB_ERROR', 'Failed to list MCP server status');
    }
  });

  /**
   * POST /api/mcp-servers
   * Create a new MCP server.
   */
  router.post('/', (req: Request, res: Response) => {
    try {
      const data = redactMcpServerForResponse(mcpServerService.createServer(req.body ?? {}));
      res.status(201).json({ success: true, data } as ApiResponse<McpServerConfig>);
    } catch (error) {
      if (error instanceof McpServerServiceError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('[MCP Servers] Error creating:', error);
      sendApiError(res, 500, 'DB_ERROR', 'Failed to create MCP server');
    }
  });

  /**
   * PUT /api/mcp-servers/:id
   * Update an MCP server.
   */
  router.put('/:id', (req: Request, res: Response) => {
    try {
      const before = mcpServerService.listServers().find(server => server.id === req.params.id);
      const data = redactMcpServerForResponse(
        mcpServerService.updateServer(req.params.id, req.body ?? {})
      );
      if (before) void mcpClientManager.disconnect(before.name);
      res.json({ success: true, data } as ApiResponse<McpServerConfig>);
    } catch (error) {
      if (error instanceof McpServerServiceError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('[MCP Servers] Error updating:', error);
      sendApiError(res, 500, 'DB_ERROR', 'Failed to update MCP server');
    }
  });

  /**
   * DELETE /api/mcp-servers/:id
   * Delete an MCP server.
   */
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const before = mcpServerService.listServers().find(server => server.id === req.params.id);
      mcpServerService.deleteServer(req.params.id);
      if (before) void mcpClientManager.disconnect(before.name);
      res.json({ success: true, data: null } as ApiResponse<null>);
    } catch (error) {
      if (error instanceof McpServerServiceError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('[MCP Servers] Error deleting:', error);
      sendApiError(res, 500, 'DB_ERROR', 'Failed to delete MCP server');
    }
  });

  /**
   * POST /api/mcp-servers/:id/toggle
   * Toggle enabled/disabled.
   */
  router.post('/:id/toggle', (req: Request, res: Response) => {
    try {
      const data = redactMcpServerForResponse(mcpServerService.toggleServer(req.params.id));
      void mcpClientManager.disconnect(data.name);
      res.json({ success: true, data } as ApiResponse<McpServerConfig>);
    } catch (error) {
      if (error instanceof McpServerServiceError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('[MCP Servers] Error toggling:', error);
      sendApiError(res, 500, 'DB_ERROR', 'Failed to toggle MCP server');
    }
  });

  function getEnabledServerByName(name: string): McpServerConfig | undefined {
    return mcpServerService.findEnabledServerByName(name);
  }

  function serverConfigFor(server: McpServerConfig) {
    if (server.transport === 'streamable-http' || server.transport === 'sse') {
      return {
        transport: server.transport,
        command: server.command,
        url: server.url || '',
        headers: server.headers,
        headersHelper: server.headersHelper,
        oauthConfig: server.oauthConfig,
        oauthCredentials: server.oauthCredentials,
        onOAuthCredentials: (credentials: McpOAuthCredentials | null) =>
          mcpServerService.updateOAuthCredentials(server.name, credentials),
      } as const;
    }
    return {
      transport: 'stdio' as const,
      command: server.command,
      ...(server.args ? { args: server.args } : {}),
      ...(server.env ? { env: server.env } : {}),
    };
  }

  function statusWithInventory(server: McpServerConfig) {
    const config = serverConfigFor(server);
    const cached = mcpInventoryCache.getCached(server.name, mcpInventoryCache.configHash(config));
    return {
      ...mcpClientManager.getStatus(server.name),
      inventory: cached?.summary,
      inventoryDetail: cached ? inventoryDetailFor(cached, server.trustPolicy) : undefined,
    };
  }

  function inventoryDetailFor(
    inventory: {
      tools: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
        annotations?: Record<string, unknown>;
      }>;
      resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }>;
      prompts: Array<{
        name: string;
        description?: string;
        arguments?: Array<{ name: string; description?: string; required?: boolean }>;
      }>;
    },
    trustPolicy?: McpServerTrustPolicy
  ): McpServerInventoryDetail {
    return {
      tools: inventory.tools.map(tool => ({
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
        annotations: tool.annotations,
        permissionSummary: inferMcpToolRisk(tool, trustPolicy),
      })),
      resources: inventory.resources.map(resource => ({
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
      })),
      prompts: inventory.prompts.map(prompt => ({
        name: prompt.name,
        description: prompt.description,
        arguments: prompt.arguments ?? [],
      })),
    };
  }

  function inferMcpToolRisk(
    tool: {
      annotations?: Record<string, unknown>;
    },
    trustPolicy?: McpServerTrustPolicy
  ): ExternalToolRiskPolicy {
    const annotations = tool.annotations ?? {};
    const declaredReadOnly = annotations.readOnlyHint === true || annotations.readOnly === true;
    const destructive = annotations.destructiveHint === true;
    const openWorld = annotations.openWorldHint !== false;
    const trustedReadOnly = !!(
      declaredReadOnly &&
      trustPolicy?.trustReadOnlyHint &&
      (trustPolicy.trustLevel === 'trusted-readonly' || trustPolicy.trustLevel === 'trusted')
    );
    const riskLevel = destructive || openWorld ? 'high' : declaredReadOnly ? 'medium' : 'high';
    return {
      declaredReadOnly,
      declaredReadOnlySource: declaredReadOnly ? 'mcp-annotations' : undefined,
      trustedReadOnly,
      mutatesWorkspace: !declaredReadOnly || destructive,
      requiresNetwork: true,
      riskLevel,
      providerTrust:
        trustPolicy?.trustLevel === 'trusted' || trustPolicy?.trustLevel === 'trusted-readonly'
          ? 'trusted'
          : 'untrusted',
      policyDecision: evaluateMcpRiskDecision({ riskLevel, declaredReadOnly }, trustPolicy),
      advisory: trustedReadOnly
        ? 'MCP read-only annotations are trusted for this server by policy.'
        : 'MCP annotations are self-declared and treated as advisory unless the provider is explicitly trusted.',
    };
  }

  function riskActionToDecision(action: McpRiskAction): 'approve' | 'deny' | 'escalate' {
    if (action === 'auto-approve') return 'approve';
    if (action === 'deny') return 'deny';
    return 'escalate';
  }

  function evaluateMcpRiskDecision(
    risk: { riskLevel: 'low' | 'medium' | 'high'; declaredReadOnly: boolean },
    policy?: McpServerTrustPolicy
  ): 'approve' | 'deny' | 'escalate' {
    const normalized = normalizeMcpServerTrustPolicy(policy);
    const explicit = normalized?.riskActions?.[risk.riskLevel];
    if (explicit) return riskActionToDecision(explicit);
    if (
      risk.declaredReadOnly &&
      normalized?.trustReadOnlyHint &&
      (normalized.trustLevel === 'trusted-readonly' || normalized.trustLevel === 'trusted')
    ) {
      return 'approve';
    }
    return riskActionToDecision(normalized?.defaultRiskAction ?? 'ask');
  }

  async function handleLifecycle(
    req: Request,
    res: Response,
    action: 'connect' | 'disconnect' | 'refresh'
  ): Promise<void> {
    const server = getEnabledServerByName(req.params.name);
    if (!server) {
      sendApiError(res, 404, 'NOT_FOUND', `Enabled MCP server "${req.params.name}" not found`);
      return;
    }
    try {
      if (action === 'connect')
        await mcpClientManager.connect(server.name, serverConfigFor(server));
      else if (action === 'refresh') {
        const config = serverConfigFor(server);
        await mcpClientManager.refresh(server.name, config);
        await mcpInventoryCache.getInventory(server.name, config, {
          listTools: () => mcpClientManager.listTools(server.name, config),
          listResources: () => mcpClientManager.listResources(server.name, config),
          listPrompts: () => mcpClientManager.listPrompts(server.name, config),
        });
      } else await mcpClientManager.disconnect(server.name);
      res.json({ success: true, data: statusWithInventory(server) });
    } catch (error) {
      console.error(`[MCP Servers] Error during ${action} for "${server.name}":`, error);
      res.status(502).json({
        success: false,
        error: {
          code: 'MCP_LIFECYCLE_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  router.post('/:name/connect', (req, res) => void handleLifecycle(req, res, 'connect'));
  router.post('/:name/disconnect', (req, res) => void handleLifecycle(req, res, 'disconnect'));
  router.post('/:name/refresh', (req, res) => void handleLifecycle(req, res, 'refresh'));

  router.post('/:name/oauth/start', async (req: Request, res: Response) => {
    const server = getEnabledServerByName(req.params.name);
    if (!server) {
      sendApiError(res, 404, 'NOT_FOUND', `Enabled MCP server "${req.params.name}" not found`);
      return;
    }
    try {
      const method = req.body?.method === 'device_code' ? 'device_code' : 'browser';
      const origin = `${req.protocol}://${req.get('host')}`;
      const data =
        method === 'device_code'
          ? await mcpOAuthSessions.startDeviceCodeFlow(server)
          : await mcpOAuthSessions.startBrowserFlow(server, origin);
      res.json({ success: true, data });
    } catch (error) {
      sendApiError(
        res,
        400,
        'MCP_OAUTH_START_FAILED',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  router.get('/:name/oauth/status/:sessionId', (req: Request, res: Response) => {
    const status = mcpOAuthSessions.getStatus(req.params.sessionId);
    if (!status) {
      sendApiError(res, 404, 'NOT_FOUND', 'OAuth session not found or expired');
      return;
    }
    res.json({ success: true, data: status });
  });

  router.post('/:name/oauth/cancel/:sessionId', (req: Request, res: Response) => {
    mcpOAuthSessions.cancel(req.params.sessionId);
    res.json({ success: true, data: { ok: true } });
  });

  router.post('/:name/oauth/signout', (req: Request, res: Response) => {
    const server = getEnabledServerByName(req.params.name);
    if (!server) {
      sendApiError(res, 404, 'NOT_FOUND', `Enabled MCP server "${req.params.name}" not found`);
      return;
    }
    mcpServerService.updateOAuthCredentials(server.name, null);
    void mcpClientManager.disconnect(server.name);
    res.json({ success: true, data: { ok: true } });
  });

  router.get('/oauth/callback', async (req: Request, res: Response) => {
    const sessionId = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const serverName = sessionId ? mcpOAuthSessions.getServerName(sessionId) : undefined;
    const server = serverName ? getEnabledServerByName(serverName) : undefined;
    if (!sessionId || !code || !server) {
      res.status(400).send('MCP OAuth callback is missing state/code or session expired.');
      return;
    }
    try {
      await mcpOAuthSessions.finishBrowserFlow(server, sessionId, code);
      void mcpClientManager.disconnect(server.name);
      res
        .status(200)
        .send('MCP authentication complete. You can close this window and return to ZClaudia.');
    } catch (error) {
      res.status(400).send(error instanceof Error ? error.message : String(error));
    }
  });

  /**
   * POST /api/mcp-servers/:name/call-tool
   * Call a tool on a named MCP server.
   *
   * Body: { tool: string, arguments?: Record<string, unknown> }
   * Returns the MCP tool result.
   */
  router.post('/:name/call-tool', async (req: Request, res: Response) => {
    const { name } = req.params;
    const { tool, arguments: toolArgs } = req.body as {
      tool?: string;
      arguments?: Record<string, unknown>;
    };

    if (!tool) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'tool name is required' },
      });
      return;
    }

    try {
      const server = mcpServerService.listServers().find(candidate => candidate.name === name);
      if (!server) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: `MCP server "${name}" not found` },
        });
        return;
      }

      if (!server.enabled) {
        res.status(400).json({
          success: false,
          error: { code: 'DISABLED', message: `MCP server "${name}" is disabled` },
        });
        return;
      }

      const result = await mcpClientManager.callTool(
        name,
        serverConfigFor(server),
        tool,
        toolArgs || {}
      );

      res.json({ success: true, data: { result } });
    } catch (error) {
      console.error(`[MCP Servers] Error calling tool "${tool}" on "${name}":`, error);
      res.status(502).json({
        success: false,
        error: {
          code: 'TOOL_CALL_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });

  /**
   * GET /api/mcp-servers/:name/tools
   * List available tools on a named MCP server.
   */
  router.get('/:name/tools', async (req: Request, res: Response) => {
    const { name } = req.params;

    try {
      const server = mcpServerService.listServers().find(candidate => candidate.name === name);
      if (!server) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: `MCP server "${name}" not found` },
        });
        return;
      }

      if (!server.enabled) {
        res.status(400).json({
          success: false,
          error: { code: 'DISABLED', message: `MCP server "${name}" is disabled` },
        });
        return;
      }

      const tools = await mcpClientManager.listTools(name, serverConfigFor(server));

      res.json({ success: true, data: { tools } });
    } catch (error) {
      console.error(`[MCP Servers] Error listing tools on "${name}":`, error);
      res.status(502).json({
        success: false,
        error: {
          code: 'LIST_TOOLS_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });

  return router;
}
