// MCP Server Types

import type { LlmProviderType } from './llm-profile.js';
import type { ExternalToolRiskPolicy } from './tools.js';
import type { RecordStatus } from './record-status.js';

export interface McpServerConfig {
  id: string;
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
  enabled: boolean;
  description?: string;
  providerScope?: LlmProviderType[];
  trustPolicy?: McpServerTrustPolicy;
  source: 'user' | 'imported';
  /** Computed on read for display; not persisted. In the plain config it reflects
   *  completeness + disabled; the /status endpoint recomputes it with live state. */
  recordStatus?: RecordStatus;
  createdAt: number;
  updatedAt: number;
}

export type McpServerTransport = 'stdio' | 'streamable-http' | 'sse';

export interface McpOAuthConfig {
  enabled: boolean;
  metadataUrl?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  deviceAuthorizationEndpoint?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  redirectUri?: string;
}

export interface McpOAuthCredentials {
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: number;
  scope?: string;
  hasAccessToken?: boolean;
  hasRefreshToken?: boolean;
}

export function normalizeMcpServerTransport(value: unknown): McpServerTransport {
  return value === 'streamable-http' || value === 'sse' ? value : 'stdio';
}

function normalizeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.trim();
  return /^https?:\/\/[^\s]+$/i.test(normalized) ? normalized : undefined;
}

export function normalizeMcpHeaders(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const headers: Record<string, string> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const name = key.trim();
    if (!name || typeof val !== 'string') continue;
    headers[name] = val;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

export function normalizeMcpHeadersHelper(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.trim();
}

export function normalizeMcpOAuthConfig(value: unknown): McpOAuthConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  const scopes = Array.isArray(input.scopes)
    ? input.scopes
        .filter((scope): scope is string => typeof scope === 'string' && !!scope.trim())
        .map(scope => scope.trim())
    : undefined;
  const config: McpOAuthConfig = {
    enabled: input.enabled === true,
    metadataUrl: normalizeUrl(input.metadataUrl),
    authorizationEndpoint: normalizeUrl(input.authorizationEndpoint),
    tokenEndpoint: normalizeUrl(input.tokenEndpoint),
    deviceAuthorizationEndpoint: normalizeUrl(input.deviceAuthorizationEndpoint),
    clientId:
      typeof input.clientId === 'string' && input.clientId.trim()
        ? input.clientId.trim()
        : undefined,
    clientSecret:
      typeof input.clientSecret === 'string' && input.clientSecret ? input.clientSecret : undefined,
    scopes: scopes && scopes.length > 0 ? scopes : undefined,
    redirectUri: normalizeUrl(input.redirectUri),
  };
  return Object.values(config).some(field => field !== undefined && field !== false)
    ? config
    : undefined;
}

export function normalizeMcpOAuthCredentials(value: unknown): McpOAuthCredentials | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  const accessToken =
    typeof input.accessToken === 'string' && input.accessToken ? input.accessToken : undefined;
  if (!accessToken && input.hasAccessToken !== true) return undefined;
  return {
    accessToken,
    refreshToken:
      typeof input.refreshToken === 'string' && input.refreshToken ? input.refreshToken : undefined,
    tokenType: typeof input.tokenType === 'string' && input.tokenType ? input.tokenType : 'Bearer',
    expiresAt:
      typeof input.expiresAt === 'number' && Number.isFinite(input.expiresAt)
        ? input.expiresAt
        : undefined,
    scope: typeof input.scope === 'string' && input.scope ? input.scope : undefined,
    hasAccessToken: input.hasAccessToken === true ? true : undefined,
    hasRefreshToken: input.hasRefreshToken === true ? true : undefined,
  };
}

export type McpServerTrustLevel = 'untrusted' | 'trusted-readonly' | 'trusted';
export type McpRiskAction = 'auto-approve' | 'ask' | 'deny';

export interface McpServerTrustPolicy {
  trustLevel: McpServerTrustLevel;
  trustReadOnlyHint: boolean;
  defaultRiskAction: McpRiskAction;
  riskActions?: Partial<Record<'low' | 'medium' | 'high', McpRiskAction>>;
}

export const defaultMcpServerTrustPolicy: McpServerTrustPolicy = {
  trustLevel: 'untrusted',
  trustReadOnlyHint: false,
  defaultRiskAction: 'ask',
  riskActions: {},
};

export function normalizeMcpServerTrustPolicy(value: unknown): McpServerTrustPolicy | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  const trustLevel =
    input.trustLevel === 'trusted-readonly' || input.trustLevel === 'trusted'
      ? input.trustLevel
      : 'untrusted';
  const riskAction = (candidate: unknown): McpRiskAction | undefined =>
    candidate === 'auto-approve' || candidate === 'ask' || candidate === 'deny'
      ? candidate
      : undefined;
  const riskActionsInput =
    input.riskActions && typeof input.riskActions === 'object'
      ? (input.riskActions as Record<string, unknown>)
      : {};
  const riskActions: Partial<Record<'low' | 'medium' | 'high', McpRiskAction>> = {};
  for (const level of ['low', 'medium', 'high'] as const) {
    const action = riskAction(riskActionsInput[level]);
    if (action) riskActions[level] = action;
  }
  return {
    trustLevel,
    trustReadOnlyHint: input.trustReadOnlyHint === true,
    defaultRiskAction: riskAction(input.defaultRiskAction) ?? 'ask',
    riskActions,
  };
}

export type McpServerStatusState =
  | 'configured'
  | 'disabled'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'needs-auth'
  | 'idle-disconnected';

export interface McpServerInventorySummary {
  tools?: number;
  resources?: number;
  prompts?: number;
  cachedAt?: number;
}

export interface McpServerInventoryToolDetail {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  permissionSummary?: ExternalToolRiskPolicy;
}

export interface McpServerInventoryResourceDetail {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpServerInventoryPromptDetail {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface McpServerInventoryDetail {
  tools: McpServerInventoryToolDetail[];
  resources: McpServerInventoryResourceDetail[];
  prompts: McpServerInventoryPromptDetail[];
}

export interface McpServerStatus {
  name: string;
  state: McpServerStatusState;
  enabled?: boolean;
  lastConnectedAt?: number;
  lastDisconnectedAt?: number;
  lastError?: string;
  authRequired?: boolean;
  authMessage?: string;
  hasInstructions?: boolean;
  instructions?: string;
  inventory?: McpServerInventorySummary;
  inventoryDetail?: McpServerInventoryDetail;
}

export interface McpInstructionSource {
  name: string;
  instructions?: string;
}

export interface McpInstructionsDelta {
  addedNames: string[];
  addedBlocks: string[];
  removedNames: string[];
  createdAt: number;
}

export const MCP_INSTRUCTIONS_DELTA_METADATA_TYPE = 'mcp_instructions_delta';

export function computeMcpInstructionsDelta(
  currentSources: McpInstructionSource[],
  previousDeltas: McpInstructionsDelta[],
  createdAt: number = Date.now()
): McpInstructionsDelta | null {
  const announced = new Set<string>();
  for (const delta of previousDeltas) {
    for (const name of delta.addedNames) announced.add(name);
    for (const name of delta.removedNames) announced.delete(name);
  }

  const current = currentSources
    .map(source => ({ name: source.name, instructions: source.instructions?.trim() ?? '' }))
    .filter(source => source.instructions)
    .sort((a, b) => a.name.localeCompare(b.name));
  const currentNames = new Set(current.map(source => source.name));
  const added = current.filter(source => !announced.has(source.name));
  const removedNames = [...announced]
    .filter(name => !currentNames.has(name))
    .sort((a, b) => a.localeCompare(b));

  if (added.length === 0 && removedNames.length === 0) return null;
  return {
    addedNames: added.map(source => source.name),
    addedBlocks: added.map(source => `## ${source.name}\n${source.instructions}`),
    removedNames,
    createdAt,
  };
}

export interface McpServerHealth {
  servers: McpServerStatus[];
  connectedCount: number;
  failedCount: number;
  disabledCount: number;
}
