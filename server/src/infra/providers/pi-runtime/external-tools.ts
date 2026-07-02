import type { AgentTool } from '@earendil-works/pi-agent-core';
import type Database from 'better-sqlite3';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  ExternalToolProviderRef,
  McpPromptRef,
  McpResourceRef,
  McpToolRef,
  PluginToolRef,
  ToolRef,
  ExternalToolRiskPolicy,
} from '@zclaudia/shared/core/tools';
import {
  normalizeMcpServerTrustPolicy,
  type McpRiskAction,
  type McpServerTrustPolicy,
} from '@zclaudia/shared/core/mcp';
import { loadMcpServersFromDb } from '../../../utils/mcp-config.js';
import type { McpServerRuntimeConfig } from '../../../utils/mcp-config.js';
import { mcpClientManager } from '../../../utils/mcp-client-manager.js';
import { mcpInventoryCache } from '../../../utils/mcp-inventory-cache.js';

type ToolContent = Array<{ type: 'text'; text: string }>;
type AgentToolParameters = AgentTool['parameters'];

const MCP_AUTHENTICATE_TOOL = 'authenticate';

const EMPTY_OBJECT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {},
  additionalProperties: true,
};

function agentToolParameters(schema: Record<string, unknown>): AgentToolParameters {
  return schema as AgentToolParameters;
}

export interface LoadedExternalToolSchema {
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  loadedAt?: number;
  schemaHash?: string;
  sourceServerConfigHash?: string;
}

function inferMcpToolRisk(
  tool: {
    annotations?: Record<string, unknown>;
    inputSchema?: Record<string, unknown>;
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
  const explicit = policy?.riskActions?.[risk.riskLevel];
  if (explicit) return riskActionToDecision(explicit);
  if (
    risk.declaredReadOnly &&
    policy?.trustReadOnlyHint &&
    (policy.trustLevel === 'trusted-readonly' || policy.trustLevel === 'trusted')
  ) {
    return 'approve';
  }
  return riskActionToDecision(policy?.defaultRiskAction ?? 'ask');
}

export interface ExternalToolRuntimeState {
  discoverableProviders: ExternalToolProviderRef[];
  pinnedExternalTools: Array<McpToolRef | PluginToolRef>;
  loadedExternalTools: Array<McpToolRef | PluginToolRef>;
  loadedExternalToolSchemas?: Record<string, LoadedExternalToolSchema>;
}

export interface ExternalToolRuntimeOptions {
  db?: Database.Database;
  state: ExternalToolRuntimeState;
  // pi Agent keeps a reference to this array, so LoadExternalTool can append
  // concrete tools for subsequent assistant steps in the same session.
  toolsArray?: AgentTool[];
}

function textResult(
  text: string,
  details: Record<string, unknown> = {}
): { content: ToolContent; details: Record<string, unknown> } {
  return { content: [{ type: 'text', text }], details };
}

export function externalToolKey(ref: ToolRef): string {
  if (ref.source === 'mcp') return `mcp:${ref.server}/${ref.tool}`;
  if (ref.source === 'mcp-resource') return `mcp-resource:${ref.server}/${ref.uri}`;
  if (ref.source === 'plugin') return `plugin:${ref.pluginId}/${ref.toolId}`;
  return `${ref.source}:unsupported`;
}

function isDiscoverableMcp(state: ExternalToolRuntimeState, server: string): boolean {
  return state.discoverableProviders.some(
    provider => provider.source === 'mcp' && provider.serverId === server
  );
}

function getMcpAuthStatus(server: string): { authRequired: boolean; message: string } | undefined {
  const status = mcpClientManager.getStatus(server);
  if (status.state !== 'needs-auth' && !status.authRequired) return undefined;
  return {
    authRequired: true,
    message:
      status.authMessage || status.lastError || `MCP server ${server} requires authentication.`,
  };
}

function mcpAuthGuidance(server: string, message: string): string {
  return [
    message,
    '',
    'Update the MCP server credentials in settings, environment variables, or the server command login flow, then refresh or reconnect the MCP server.',
    'This project currently supports stdio MCP servers, so no automatic browser OAuth flow is available for this server configuration.',
  ].join('\n');
}

function isLoaded(state: ExternalToolRuntimeState, ref: McpToolRef | PluginToolRef): boolean {
  const key = externalToolKey(ref);
  return [...state.pinnedExternalTools, ...state.loadedExternalTools].some(
    item => externalToolKey(item) === key
  );
}

function safeLoadMcpServers(db?: Database.Database) {
  if (!db) return {};
  try {
    return loadMcpServersFromDb(db, 'zclaudia');
  } catch {
    return {};
  }
}

function loadMcpTrustPolicy(
  db: Database.Database | undefined,
  server: string
): McpServerTrustPolicy | undefined {
  if (!db) return undefined;
  try {
    const row = db.prepare('SELECT trust_policy FROM mcp_servers WHERE name = ?').get(server) as
      | { trust_policy?: string | null }
      | undefined;
    if (!row?.trust_policy) return undefined;
    return normalizeMcpServerTrustPolicy(JSON.parse(row.trust_policy));
  } catch {
    return undefined;
  }
}

const PROVIDER_CATALOG_MAX_ROWS = 20;
const PROVIDER_CATALOG_DESC_MAX = 120;
const DEFAULT_MCP_MAX_OUTPUT_CHARS = 80_000;
const MCP_OUTPUT_TRUNCATED_MARKER = '[OUTPUT TRUNCATED: MCP text result exceeded';

function truncateForCatalog(text: string, max = PROVIDER_CATALOG_DESC_MAX): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function maxMcpOutputChars(): number {
  const parsed = Number(process.env.ZCLAUDIA_MCP_MAX_OUTPUT_CHARS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MCP_MAX_OUTPUT_CHARS;
}

function mcpOutputDir(): string {
  return process.env.ZCLAUDIA_MCP_OUTPUT_DIR || path.join(tmpdir(), 'zclaudia-mcp-output');
}

function sanitizeOutputName(value: string): string {
  const base = value.split(/[\\/]/).pop() || 'mcp-output';
  return base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'mcp-output';
}

function extensionForMimeType(mimeType?: string): string {
  const normalized = (mimeType || '').split(';')[0].trim().toLowerCase();
  if (normalized === 'application/pdf') return 'pdf';
  if (normalized === 'application/json') return 'json';
  if (normalized === 'text/markdown') return 'md';
  if (normalized === 'text/plain') return 'txt';
  if (normalized === 'text/csv') return 'csv';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/jpeg') return 'jpg';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/webp') return 'webp';
  return 'bin';
}

async function persistMcpOutput(
  name: string,
  index: number,
  data: string | Buffer,
  extension: string
): Promise<string> {
  const dir = mcpOutputDir();
  await mkdir(dir, { recursive: true });
  const filePath = path.join(
    dir,
    `${sanitizeOutputName(name)}-${Date.now()}-${index}.${extension}`
  );
  await writeFile(filePath, data);
  return filePath;
}

async function truncateMcpTextContent(
  content: ToolContent,
  name: string
): Promise<{
  content: ToolContent;
  outputTruncated: boolean;
  originalOutputChars?: number;
  outputFiles: string[];
}> {
  const max = maxMcpOutputChars();
  let outputTruncated = false;
  let originalOutputChars: number | undefined;
  const outputFiles: string[] = [];
  const truncated = await Promise.all(
    content.map(async (item, index) => {
      if (item.type !== 'text' || typeof item.text !== 'string' || item.text.length <= max)
        return item;
      outputTruncated = true;
      originalOutputChars = Math.max(originalOutputChars ?? 0, item.text.length);
      const outputPath = await persistMcpOutput(name, index, item.text, 'txt');
      outputFiles.push(outputPath);
      return {
        ...item,
        text: `${item.text.slice(0, max)}\n\n${MCP_OUTPUT_TRUNCATED_MARKER} ${max} characters]\nFull output saved to ${outputPath}`,
      };
    })
  );
  return { content: truncated, outputTruncated, originalOutputChars, outputFiles };
}

async function getMcpInventory(server: string, config: McpServerRuntimeConfig) {
  return mcpInventoryCache.getInventory(server, config, {
    listTools: () => mcpClientManager.listTools(server, config),
    listResources: () => mcpClientManager.listResources(server, config),
    listPrompts: () => mcpClientManager.listPrompts(server, config),
  });
}

function schemaHash(value: unknown): string {
  return JSON.stringify(value);
}

export function buildExternalProviderCatalog(
  state: ExternalToolRuntimeState,
  db?: Database.Database
): string {
  if (state.discoverableProviders.length === 0) return '';
  const servers = safeLoadMcpServers(db);
  const providers = [...state.discoverableProviders]
    .sort((a, b) => {
      const left =
        a.source === 'mcp' ? `mcp/${a.serverId}` : `plugin/${a.pluginId}/${a.providerId ?? ''}`;
      const right =
        b.source === 'mcp' ? `mcp/${b.serverId}` : `plugin/${b.pluginId}/${b.providerId ?? ''}`;
      return left.localeCompare(right);
    })
    .slice(0, PROVIDER_CATALOG_MAX_ROWS);
  const rows = providers.map(provider => {
    if (provider.source === 'mcp') {
      const status = servers[provider.serverId] ? 'configured' : 'unavailable';
      const config = servers[provider.serverId];
      const summary = config
        ? mcpInventoryCache.getCached(provider.serverId, mcpInventoryCache.configHash(config))
            ?.summary
        : undefined;
      const counts = summary
        ? `tools=${summary.tools ?? 0}, resources=${summary.resources ?? 0}, prompts=${summary.prompts ?? 0}`
        : 'tools=unknown, resources=unknown, prompts=unknown';
      return truncateForCatalog(
        `- mcp/${provider.serverId}: status=${status}, ${counts}, discover tools via SearchExternalTools, resources via SearchExternalResources, prompts via SearchExternalPrompts`
      );
    }
    const providerId = provider.providerId ? `/${provider.providerId}` : '';
    return truncateForCatalog(
      `- plugin/${provider.pluginId}${providerId}: status=not-yet-connected`
    );
  });
  const omitted = state.discoverableProviders.length - providers.length;
  const suffix = omitted > 0 ? `\n- ... ${omitted} more provider(s) omitted by catalog budget` : '';
  return `Discoverable external tool providers:\n${rows.join('\n')}${suffix}`;
}

export function concreteMcpToolName(ref: McpToolRef): string {
  return `mcp__${ref.server}__${ref.tool}`;
}

export function createConcreteMcpTool(
  ref: McpToolRef,
  db?: Database.Database,
  metadata?: LoadedExternalToolSchema
): AgentTool {
  const name = concreteMcpToolName(ref);
  return {
    name,
    label: name,
    description: metadata?.description || `Loaded MCP tool ${ref.tool} from server ${ref.server}.`,
    parameters: agentToolParameters(metadata?.inputSchema ?? EMPTY_OBJECT_SCHEMA),
    execute: async (_toolCallId: string, params: unknown) => {
      try {
        if (ref.tool === MCP_AUTHENTICATE_TOOL) {
          const authStatus = getMcpAuthStatus(ref.server);
          const message =
            authStatus?.message || `MCP server ${ref.server} may require authentication.`;
          return textResult(mcpAuthGuidance(ref.server, message), {
            ok: false,
            error: 'mcp_auth_required',
            authRequired: true,
            server: ref.server,
            tool: ref.tool,
          });
        }
        const servers = db ? loadMcpServersFromDb(db, 'zclaudia') : {};
        const config = servers[ref.server];
        if (!config) {
          return textResult(`MCP server is not configured or disabled: ${ref.server}`, {
            ok: false,
            error: 'server_unavailable',
            server: ref.server,
            tool: ref.tool,
          });
        }
        const trustPolicy = loadMcpTrustPolicy(db, ref.server);
        const permissionSummary = metadata ? inferMcpToolRisk(metadata, trustPolicy) : undefined;
        if (permissionSummary?.policyDecision === 'deny') {
          const mcpTrust = {
            server: ref.server,
            tool: ref.tool,
            riskLevel: permissionSummary.riskLevel,
            trustLevel: trustPolicy?.trustLevel ?? 'untrusted',
            policyDecision: 'deny',
          };
          return textResult('Denied by MCP trust policy', {
            ok: false,
            error: 'mcp_tool_denied_by_policy',
            server: ref.server,
            tool: ref.tool,
            permissionSummary,
            mcpTrust,
          });
        }
        const result = await mcpClientManager.callTool(
          ref.server,
          config,
          ref.tool,
          (params as Record<string, unknown>) || {}
        );
        const output = await truncateMcpTextContent(result.content as ToolContent, ref.tool);
        return {
          content: output.content,
          details: {
            ok: !result.isError,
            server: ref.server,
            tool: ref.tool,
            isError: !!result.isError,
            permissionSummary,
            ...(output.outputTruncated && {
              outputTruncated: true,
              originalOutputChars: output.originalOutputChars,
              outputPersisted: output.outputFiles.length > 0,
              outputFiles: output.outputFiles,
            }),
          },
        };
      } catch (err) {
        return textResult(err instanceof Error ? err.message : String(err), {
          ok: false,
          error: 'mcp_tool_failed',
          server: ref.server,
          tool: ref.tool,
        });
      }
    },
  };
}

async function inspectExternalTool(
  state: ExternalToolRuntimeState,
  db: Database.Database | undefined,
  params: unknown
) {
  const ref = (params as { ref?: unknown })?.ref as Partial<McpToolRef> | undefined;
  if (!ref || ref.source !== 'mcp' || !ref.server || !ref.tool) {
    return textResult('InspectExternalTool requires an MCP ref', {
      ok: false,
      error: 'invalid_ref',
    });
  }
  if (!isDiscoverableMcp(state, ref.server)) {
    return textResult(`MCP server is not discoverable: ${ref.server}`, {
      ok: false,
      error: 'provider_not_discoverable',
      server: ref.server,
      tool: ref.tool,
    });
  }
  const servers = safeLoadMcpServers(db);
  const config = servers[ref.server];
  if (!config) {
    return textResult(`MCP server is not configured or disabled: ${ref.server}`, {
      ok: false,
      error: 'server_unavailable',
      server: ref.server,
      tool: ref.tool,
    });
  }
  if (ref.tool === MCP_AUTHENTICATE_TOOL) {
    const authStatus = getMcpAuthStatus(ref.server);
    return textResult(
      JSON.stringify(
        {
          ref: { source: 'mcp', server: ref.server, tool: MCP_AUTHENTICATE_TOOL },
          name: MCP_AUTHENTICATE_TOOL,
          description: 'Show authentication guidance for this MCP server.',
          inputSchema: { type: 'object', properties: {} },
          authRequired: !!authStatus,
          authMessage: authStatus?.message,
          loaded: isLoaded(state, {
            source: 'mcp',
            server: ref.server,
            tool: MCP_AUTHENTICATE_TOOL,
          } as McpToolRef),
        },
        null,
        2
      ),
      { ok: true }
    );
  }
  const inventory = await getMcpInventory(ref.server, config);
  const tool = inventory.tools.find(item => item.name === ref.tool);
  if (!tool)
    return textResult(`Tool not found: ${ref.tool}`, { ok: false, error: 'tool_not_found' });
  const concrete = { source: 'mcp', server: ref.server, tool: ref.tool } as McpToolRef;
  const trustPolicy = loadMcpTrustPolicy(db, ref.server);
  return textResult(
    JSON.stringify(
      {
        ref: concrete,
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
        permissionSummary: inferMcpToolRisk(
          tool as { annotations?: Record<string, unknown>; inputSchema?: Record<string, unknown> },
          trustPolicy
        ),
        loaded: isLoaded(state, concrete),
      },
      null,
      2
    ),
    { ok: true }
  );
}

async function loadExternalTool(options: ExternalToolRuntimeOptions, params: unknown) {
  const ref = (params as { ref?: unknown })?.ref as Partial<McpToolRef> | undefined;
  if (!ref || ref.source !== 'mcp' || !ref.server || !ref.tool) {
    return textResult('LoadExternalTool requires an MCP ref', { ok: false, error: 'invalid_ref' });
  }
  if (!isDiscoverableMcp(options.state, ref.server)) {
    return textResult(`MCP server is not discoverable: ${ref.server}`, {
      ok: false,
      error: 'provider_not_discoverable',
      server: ref.server,
      tool: ref.tool,
    });
  }

  const concrete = { source: 'mcp', server: ref.server, tool: ref.tool } as McpToolRef;
  if (!isLoaded(options.state, concrete)) {
    const servers = safeLoadMcpServers(options.db);
    const config = servers[concrete.server];
    if (!config) {
      return textResult(`MCP server is not configured or disabled: ${concrete.server}`, {
        ok: false,
        error: 'server_unavailable',
        server: concrete.server,
        tool: concrete.tool,
      });
    }
    if (concrete.tool === MCP_AUTHENTICATE_TOOL) {
      options.state.loadedExternalToolSchemas ??= {};
      options.state.loadedExternalToolSchemas[externalToolKey(concrete)] = {
        description: 'Show authentication guidance for this MCP server.',
        inputSchema: { type: 'object', properties: {} },
        loadedAt: Date.now(),
        schemaHash: schemaHash({ type: 'object', properties: {} }),
        sourceServerConfigHash: mcpInventoryCache.configHash(config),
      };
      options.state.loadedExternalTools.push(concrete);
      options.state.loadedExternalTools.sort((a, b) =>
        externalToolKey(a).localeCompare(externalToolKey(b))
      );
      options.toolsArray?.push(
        createConcreteMcpTool(
          concrete,
          options.db,
          options.state.loadedExternalToolSchemas?.[externalToolKey(concrete)]
        )
      );
      return textResult(
        JSON.stringify(
          {
            loaded: true,
            ref: concrete,
            toolName: concreteMcpToolName(concrete),
            availability: 'next_model_request',
            message:
              'Authentication helper loaded for this session. It will be available as a callable tool in the next assistant step.',
          },
          null,
          2
        ),
        { ok: true, loaded: true }
      );
    }
    const inventory = await getMcpInventory(concrete.server, config);
    const found = inventory.tools.find(tool => tool.name === concrete.tool);
    if (!found)
      return textResult(`Tool not found: ${concrete.tool}`, { ok: false, error: 'tool_not_found' });

    options.state.loadedExternalToolSchemas ??= {};
    options.state.loadedExternalToolSchemas[externalToolKey(concrete)] = {
      description: found.description ?? '',
      inputSchema: found.inputSchema ?? { type: 'object', properties: {} },
      annotations: (found as { annotations?: Record<string, unknown> }).annotations,
      loadedAt: Date.now(),
      schemaHash: schemaHash(found.inputSchema ?? {}),
      sourceServerConfigHash: inventory.configHash,
    };
    options.state.loadedExternalTools.push(concrete);
    options.state.loadedExternalTools.sort((a, b) =>
      externalToolKey(a).localeCompare(externalToolKey(b))
    );
    options.toolsArray?.push(
      createConcreteMcpTool(
        concrete,
        options.db,
        options.state.loadedExternalToolSchemas?.[externalToolKey(concrete)]
      )
    );
  }

  return textResult(
    JSON.stringify(
      {
        loaded: true,
        ref: concrete,
        toolName: concreteMcpToolName(concrete),
        availability: 'next_model_request',
        message:
          'Tool loaded for this session. It will be available as a callable tool in the next assistant step.',
      },
      null,
      2
    ),
    { ok: true }
  );
}

async function searchExternalResources(
  state: ExternalToolRuntimeState,
  db: Database.Database | undefined,
  params: unknown
) {
  const args = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
  const query = String(args.query ?? '').toLowerCase();
  const limit = Math.max(1, Math.min(Number(args.limit ?? 20) || 20, 100));
  const servers = safeLoadMcpServers(db);
  const results: Array<Record<string, unknown>> = [];
  for (const provider of state.discoverableProviders) {
    if (provider.source !== 'mcp') continue;
    const config = servers[provider.serverId];
    if (!config) continue;
    const inventory = await getMcpInventory(provider.serverId, config);
    for (const resource of inventory.resources) {
      const haystack =
        `${provider.serverId} ${resource.uri} ${resource.name ?? ''} ${resource.description ?? ''}`.toLowerCase();
      if (query && !haystack.includes(query)) continue;
      results.push({
        ref: {
          source: 'mcp-resource',
          server: provider.serverId,
          uri: resource.uri,
        } as McpResourceRef,
        name: resource.name ?? resource.uri,
        providerLabel: `mcp/${provider.serverId}`,
        description: resource.description ?? '',
        mimeType: resource.mimeType,
      });
      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }
  return textResult(JSON.stringify({ results }, null, 2), { ok: true, total: results.length });
}

async function inspectExternalResource(
  state: ExternalToolRuntimeState,
  db: Database.Database | undefined,
  params: unknown
) {
  const ref = (params as { ref?: unknown })?.ref as Partial<McpResourceRef> | undefined;
  if (!ref || ref.source !== 'mcp-resource' || !ref.server || !ref.uri) {
    return textResult('InspectExternalResource requires an MCP resource ref', {
      ok: false,
      error: 'invalid_ref',
    });
  }
  if (!isDiscoverableMcp(state, ref.server)) {
    return textResult(`MCP server is not discoverable: ${ref.server}`, {
      ok: false,
      error: 'provider_not_discoverable',
      server: ref.server,
      uri: ref.uri,
    });
  }
  const servers = safeLoadMcpServers(db);
  const config = servers[ref.server];
  if (!config)
    return textResult(`MCP server is not configured or disabled: ${ref.server}`, {
      ok: false,
      error: 'server_unavailable',
    });
  const inventory = await getMcpInventory(ref.server, config);
  const resource = inventory.resources.find(item => item.uri === ref.uri);
  if (!resource)
    return textResult(`Resource not found: ${ref.uri}`, { ok: false, error: 'resource_not_found' });
  return textResult(
    JSON.stringify(
      {
        ref: { source: 'mcp-resource', server: ref.server, uri: ref.uri },
        uri: resource.uri,
        name: resource.name ?? resource.uri,
        description: resource.description ?? '',
        mimeType: resource.mimeType,
        readOnly: true,
      },
      null,
      2
    ),
    { ok: true }
  );
}

async function readExternalResource(
  state: ExternalToolRuntimeState,
  db: Database.Database | undefined,
  params: unknown
) {
  const ref = (params as { ref?: unknown })?.ref as Partial<McpResourceRef> | undefined;
  if (!ref || ref.source !== 'mcp-resource' || !ref.server || !ref.uri) {
    return textResult('ReadExternalResource requires an MCP resource ref', {
      ok: false,
      error: 'invalid_ref',
    });
  }
  const resourceUri = ref.uri;
  if (!isDiscoverableMcp(state, ref.server)) {
    return textResult(`MCP server is not discoverable: ${ref.server}`, {
      ok: false,
      error: 'provider_not_discoverable',
    });
  }
  const servers = safeLoadMcpServers(db);
  const config = servers[ref.server];
  if (!config)
    return textResult(`MCP server is not configured or disabled: ${ref.server}`, {
      ok: false,
      error: 'server_unavailable',
    });
  const result = await mcpClientManager.readResource(ref.server, config, resourceUri);
  const outputFiles: string[] = [];
  const content = await Promise.all(
    result.contents.map(async (item, index) => {
      if (item.text) {
        return { type: 'text' as const, text: item.text };
      }
      if (item.blob) {
        const bytes = Buffer.from(item.blob, 'base64');
        const ext = extensionForMimeType(item.mimeType);
        const outputPath = await persistMcpOutput(item.uri || resourceUri, index, bytes, ext);
        outputFiles.push(outputPath);
        return {
          type: 'text' as const,
          text: `Binary content (${item.mimeType || 'application/octet-stream'}, ${bytes.length} bytes) saved to ${outputPath}`,
        };
      }
      return { type: 'text' as const, text: '' };
    })
  );
  return {
    content,
    details: {
      ok: true,
      server: ref.server,
      uri: resourceUri,
      ...(outputFiles.length > 0 && {
        outputPersisted: true,
        outputFiles,
      }),
      contents: result.contents.map(({ uri, mimeType, text, blob }) => ({
        uri,
        mimeType,
        size: text?.length ?? blob?.length ?? 0,
        binary: !!blob,
      })),
    },
  };
}

async function searchExternalPrompts(
  state: ExternalToolRuntimeState,
  db: Database.Database | undefined,
  params: unknown
) {
  const args = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
  const query = String(args.query ?? '').toLowerCase();
  const limit = Math.max(1, Math.min(Number(args.limit ?? 20) || 20, 100));
  const servers = safeLoadMcpServers(db);
  const results: Array<Record<string, unknown>> = [];
  for (const provider of state.discoverableProviders) {
    if (provider.source !== 'mcp') continue;
    const config = servers[provider.serverId];
    if (!config) continue;
    const inventory = await getMcpInventory(provider.serverId, config);
    for (const prompt of inventory.prompts) {
      const haystack =
        `${provider.serverId} ${prompt.name} ${prompt.description ?? ''}`.toLowerCase();
      if (query && !haystack.includes(query)) continue;
      results.push({
        ref: { source: 'mcp-prompt', server: provider.serverId, name: prompt.name } as McpPromptRef,
        name: prompt.name,
        providerLabel: `mcp/${provider.serverId}`,
        description: prompt.description ?? '',
        arguments: prompt.arguments ?? [],
      });
      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }
  return textResult(JSON.stringify({ results }, null, 2), { ok: true, total: results.length });
}

async function loadExternalPrompt(
  state: ExternalToolRuntimeState,
  db: Database.Database | undefined,
  params: unknown
) {
  const args = (params && typeof params === 'object' ? params : {}) as {
    ref?: Partial<McpPromptRef>;
    arguments?: Record<string, unknown>;
  };
  const ref = args.ref;
  if (!ref || ref.source !== 'mcp-prompt' || !ref.server || !ref.name) {
    return textResult('LoadExternalPrompt requires an MCP prompt ref', {
      ok: false,
      error: 'invalid_ref',
    });
  }
  if (!isDiscoverableMcp(state, ref.server)) {
    return textResult(`MCP server is not discoverable: ${ref.server}`, {
      ok: false,
      error: 'provider_not_discoverable',
    });
  }
  const servers = safeLoadMcpServers(db);
  const config = servers[ref.server];
  if (!config)
    return textResult(`MCP server is not configured or disabled: ${ref.server}`, {
      ok: false,
      error: 'server_unavailable',
    });
  const prompt = await mcpClientManager.getPrompt(ref.server, config, ref.name, args.arguments);
  return textResult(
    JSON.stringify(
      {
        ref: { source: 'mcp-prompt', server: ref.server, name: ref.name },
        description: prompt.description ?? '',
        messages: prompt.messages ?? [],
      },
      null,
      2
    ),
    { ok: true }
  );
}

export function buildExternalMetaTools(options: ExternalToolRuntimeOptions): AgentTool[] {
  const { state, db } = options;
  return [
    {
      name: 'ListExternalToolProviders',
      label: 'ListExternalToolProviders',
      description: 'List external MCP/plugin providers that this agent is allowed to discover.',
      parameters: agentToolParameters({ type: 'object', properties: {} }),
      execute: async () =>
        textResult(JSON.stringify({ providers: state.discoverableProviders }, null, 2), {
          ok: true,
        }),
    },
    {
      name: 'SearchExternalTools',
      label: 'SearchExternalTools',
      description: 'Search discoverable external MCP/plugin tools without loading every schema.',
      parameters: agentToolParameters({
        type: 'object',
        properties: {
          query: { type: 'string' },
          provider: { type: 'object' },
          limit: { type: 'number', default: 20 },
        },
      }),
      execute: async (_id: string, params: unknown) => {
        const args = (params && typeof params === 'object' ? params : {}) as Record<
          string,
          unknown
        >;
        const query = String(args.query ?? '').toLowerCase();
        const limit = Math.max(1, Math.min(Number(args.limit ?? 20) || 20, 100));
        const servers = safeLoadMcpServers(db);
        const results: Array<Record<string, unknown>> = [];
        for (const provider of state.discoverableProviders) {
          if (provider.source !== 'mcp') continue;
          const config = servers[provider.serverId];
          if (!config) continue;
          const authStatus = getMcpAuthStatus(provider.serverId);
          if (authStatus) {
            const ref = {
              source: 'mcp',
              server: provider.serverId,
              tool: MCP_AUTHENTICATE_TOOL,
            } as McpToolRef;
            const haystack =
              `${provider.serverId} ${MCP_AUTHENTICATE_TOOL} authentication login oauth credentials ${authStatus.message}`.toLowerCase();
            if (!query || haystack.includes(query)) {
              results.push({
                ref,
                name: MCP_AUTHENTICATE_TOOL,
                providerLabel: `mcp/${provider.serverId}`,
                description: authStatus.message,
                authRequired: true,
                loaded: isLoaded(state, ref),
                blocked: false,
              });
            }
            if (results.length >= limit) break;
            continue;
          }
          const inventory = await getMcpInventory(provider.serverId, config);
          const trustPolicy = loadMcpTrustPolicy(db, provider.serverId);
          for (const tool of inventory.tools) {
            const haystack =
              `${provider.serverId} ${tool.name} ${tool.description ?? ''}`.toLowerCase();
            if (query && !haystack.includes(query)) continue;
            const ref = { source: 'mcp', server: provider.serverId, tool: tool.name } as McpToolRef;
            results.push({
              ref,
              name: tool.name,
              providerLabel: `mcp/${provider.serverId}`,
              description: tool.description ?? '',
              permissionSummary: inferMcpToolRisk(
                tool as {
                  annotations?: Record<string, unknown>;
                  inputSchema?: Record<string, unknown>;
                },
                trustPolicy
              ),
              loaded: isLoaded(state, ref),
              blocked: false,
            });
            if (results.length >= limit) break;
          }
          if (results.length >= limit) break;
        }
        return textResult(JSON.stringify({ results }, null, 2), {
          ok: true,
          total: results.length,
        });
      },
    },
    {
      name: 'InspectExternalTool',
      label: 'InspectExternalTool',
      description: 'Inspect one external tool and return its full description and input schema.',
      parameters: agentToolParameters({
        type: 'object',
        properties: { ref: { type: 'object' } },
        required: ['ref'],
      }),
      execute: async (_id: string, params: unknown) => inspectExternalTool(state, db, params),
    },
    {
      name: 'SearchExternalResources',
      label: 'SearchExternalResources',
      description:
        'Search discoverable MCP resources without exposing every resource in the prompt.',
      parameters: agentToolParameters({
        type: 'object',
        properties: {
          query: { type: 'string' },
          provider: { type: 'object' },
          limit: { type: 'number', default: 20 },
        },
      }),
      execute: async (_id: string, params: unknown) => searchExternalResources(state, db, params),
    },
    {
      name: 'InspectExternalResource',
      label: 'InspectExternalResource',
      description: 'Inspect one MCP resource and return metadata before reading it.',
      parameters: agentToolParameters({
        type: 'object',
        properties: { ref: { type: 'object' } },
        required: ['ref'],
      }),
      execute: async (_id: string, params: unknown) => inspectExternalResource(state, db, params),
    },
    {
      name: 'ReadExternalResource',
      label: 'ReadExternalResource',
      description: 'Read one discoverable MCP resource as read-only content.',
      parameters: agentToolParameters({
        type: 'object',
        properties: { ref: { type: 'object' } },
        required: ['ref'],
      }),
      execute: async (_id: string, params: unknown) => readExternalResource(state, db, params),
    },
    {
      name: 'SearchExternalPrompts',
      label: 'SearchExternalPrompts',
      description: 'Search discoverable MCP prompts without exposing every prompt in the prompt.',
      parameters: agentToolParameters({
        type: 'object',
        properties: {
          query: { type: 'string' },
          provider: { type: 'object' },
          limit: { type: 'number', default: 20 },
        },
      }),
      execute: async (_id: string, params: unknown) => searchExternalPrompts(state, db, params),
    },
    {
      name: 'LoadExternalPrompt',
      label: 'LoadExternalPrompt',
      description: 'Load a discoverable MCP prompt and return its rendered messages.',
      parameters: agentToolParameters({
        type: 'object',
        properties: { ref: { type: 'object' }, arguments: { type: 'object' } },
        required: ['ref'],
      }),
      execute: async (_id: string, params: unknown) => loadExternalPrompt(state, db, params),
    },
    {
      name: 'LoadExternalTool',
      label: 'LoadExternalTool',
      description:
        'Load one inspected external tool for this session. It becomes callable on the next assistant step.',
      parameters: agentToolParameters({
        type: 'object',
        properties: { ref: { type: 'object' } },
        required: ['ref'],
      }),
      execute: async (_id: string, params: unknown) => loadExternalTool(options, params),
    },
  ];
}
