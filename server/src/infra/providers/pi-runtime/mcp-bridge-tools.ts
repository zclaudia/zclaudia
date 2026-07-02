import type { AgentTool } from '@earendil-works/pi-agent-core';
import type Database from 'better-sqlite3';

import { loadMcpServersFromDb } from '../../../utils/mcp-config.js';
import { mcpClientManager } from '../../../utils/mcp-client-manager.js';
import type { ToolContent } from './tool-common.js';
import { errorResult, textResult, toolParams } from './tool-common.js';

type AgentToolParameters = AgentTool['parameters'];

function agentToolParameters(schema: Record<string, unknown>): AgentToolParameters {
  return schema as AgentToolParameters;
}

function normalizeMcpToolContent(
  content: Array<{ type: string; text?: string; data?: unknown; mimeType?: unknown }>
): ToolContent {
  return content.map(item => {
    if (item.type === 'text') {
      return { type: 'text', text: item.text ?? '' };
    }
    if (
      item.type === 'image' &&
      typeof item.data === 'string' &&
      typeof item.mimeType === 'string'
    ) {
      return { type: 'image', data: item.data, mimeType: item.mimeType };
    }
    return { type: 'text', text: JSON.stringify(item) };
  });
}

function getMcpServer(db: Database.Database | undefined, serverName: string) {
  if (!db) throw new Error('MCP tools require a database-backed run context');
  const servers = loadMcpServersFromDb(db, 'zclaudia');
  const config = servers[serverName];
  if (!config) throw new Error(`MCP server not configured or enabled: ${serverName}`);
  return config;
}

function mcpErrorCode(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('database-backed run context')) return 'missing_db_context';
  if (message.includes('not configured or enabled')) return 'server_not_configured';
  if (message.includes('timeout')) return 'request_timeout';
  if (message.includes('not running') || message.includes('exited')) return 'server_unavailable';
  return 'mcp_error';
}

export function createMcpTool(db?: Database.Database): AgentTool {
  return {
    name: 'MCPTool',
    label: 'MCPTool',
    description: 'Call a tool exposed by a configured MCP server.',
    parameters: agentToolParameters({
      type: 'object',
      properties: {
        server: { type: 'string' },
        tool: { type: 'string' },
        arguments: { type: 'object' },
      },
      required: ['server', 'tool'],
    }),
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      const server = String(args.server || '');
      const tool = String(args.tool || '');
      if (!server) return errorResult('missing_server', 'MCPTool requires a server name');
      if (!tool) return errorResult('missing_tool', 'MCPTool requires a tool name', { server });
      try {
        const config = getMcpServer(db, server);
        const result = await mcpClientManager.callTool(
          server,
          config,
          tool,
          (args.arguments as Record<string, unknown>) || {}
        );
        return {
          content: normalizeMcpToolContent(result.content),
          details: { ok: !result.isError, server, tool, isError: !!result.isError },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(mcpErrorCode(err), message, { server, tool });
      }
    },
  };
}

export function createToolSearchTool(db?: Database.Database): AgentTool {
  return {
    name: 'ToolSearch',
    label: 'ToolSearch',
    description:
      'Search tools exposed by configured MCP servers without loading every schema into the prompt.',
    parameters: agentToolParameters({
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search text matched against server, tool name, and description',
        },
        server: { type: 'string', description: 'Optional MCP server name' },
        max_results: { type: 'number', default: 20 },
        include_schema: { type: 'boolean', default: false },
      },
    }),
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (!db)
        return errorResult(
          'missing_db_context',
          'ToolSearch requires a database-backed run context'
        );
      const query = String(args.query ?? '')
        .trim()
        .toLowerCase();
      const maxResults = Math.max(1, Math.min(Number(args.max_results ?? 20) || 20, 100));
      const includeSchema = args.include_schema === true;
      const servers = loadMcpServersFromDb(db, 'zclaudia');
      const requested = args.server ? [String(args.server)] : Object.keys(servers);
      const results: Array<Record<string, unknown>> = [];
      const errors: Array<{ server: string; error: string }> = [];

      for (const server of requested) {
        const config = servers[server];
        if (!config) {
          errors.push({ server, error: 'not configured or disabled' });
          continue;
        }
        try {
          const tools = await mcpClientManager.listTools(server, config);
          for (const tool of tools) {
            const haystack = `${server} ${tool.name} ${tool.description ?? ''}`.toLowerCase();
            if (query && !haystack.includes(query)) continue;
            results.push({
              server,
              tool: tool.name,
              description: tool.description,
              ...(includeSchema && { inputSchema: tool.inputSchema }),
            });
            if (results.length >= maxResults) break;
          }
        } catch (err) {
          errors.push({ server, error: err instanceof Error ? err.message : String(err) });
        }
        if (results.length >= maxResults) break;
      }

      return textResult(
        JSON.stringify(
          {
            query,
            results,
            errors,
            total: results.length,
          },
          null,
          2
        ),
        { ok: true, query, total: results.length, errors }
      );
    },
  };
}

export function createListMcpResourcesTool(db?: Database.Database): AgentTool {
  return {
    name: 'ListMcpResources',
    label: 'ListMcpResources',
    description: 'List resources exposed by configured MCP servers.',
    parameters: agentToolParameters({
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Optional MCP server name' },
      },
    }),
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (!db)
        return errorResult(
          'missing_db_context',
          'MCP resources require a database-backed run context'
        );
      const servers = loadMcpServersFromDb(db, 'zclaudia');
      const requested = args.server ? [String(args.server)] : Object.keys(servers);
      const resources = [];
      for (const server of requested) {
        const config = servers[server];
        if (!config) {
          resources.push({ server, error: 'not configured or disabled' });
          continue;
        }
        try {
          resources.push({
            server,
            resources: await mcpClientManager.listResources(server, config),
          });
        } catch (err) {
          resources.push({ server, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return textResult(JSON.stringify(resources, null, 2), { ok: true, count: resources.length });
    },
  };
}

export function createReadMcpResourceTool(db?: Database.Database): AgentTool {
  return {
    name: 'ReadMcpResource',
    label: 'ReadMcpResource',
    description: 'Read a resource exposed by a configured MCP server.',
    parameters: agentToolParameters({
      type: 'object',
      properties: {
        server: { type: 'string' },
        uri: { type: 'string' },
      },
      required: ['server', 'uri'],
    }),
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      const server = String(args.server || '');
      const uri = String(args.uri || '');
      if (!server) return errorResult('missing_server', 'ReadMcpResource requires a server name');
      if (!uri)
        return errorResult('missing_uri', 'ReadMcpResource requires a resource URI', { server });
      try {
        const config = getMcpServer(db, server);
        const result = await mcpClientManager.readResource(server, config, uri);
        return textResult(JSON.stringify(result, null, 2), {
          ok: true,
          server,
          uri,
          count: result.contents?.length ?? 0,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(mcpErrorCode(err), message, { server, uri });
      }
    },
  };
}
