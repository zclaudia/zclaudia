// LLM connection profile types (replaces the old `provider.ts` profile shape).

import type { RecordStatus } from './record-status.js';

/**
 * Canonical LLM provider type list. `openai-custom` was merged into `openai`
 * in migration 004 — both shapes had identical wire behaviour (the only
 * difference was whether `baseUrl` was required). The merged `openai` entry
 * accepts an optional baseUrl; when absent the runtime defaults to
 * `https://api.openai.com/v1`.
 */
export const LLM_PROVIDER_TYPES = ['anthropic', 'openai', 'openai-codex'] as const;

export type LlmProviderType = (typeof LLM_PROVIDER_TYPES)[number] | string;

/**
 * Wire protocols an LLM endpoint can speak. This describes endpoint *capability*
 * — it does not change how the built-in pi transport picks a protocol for the
 * existing runtimes.
 */
export const LLM_WIRE_PROTOCOLS = [
  'anthropic-messages',
  'openai-completions',
  'openai-responses',
] as const;

export type LlmWireProtocol = (typeof LLM_WIRE_PROTOCOLS)[number];

/** Wire null restores inference; [] is an explicit declaration of no protocols. */
export function validateLlmProtocols(value: unknown): LlmWireProtocol[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.some(p => !LLM_WIRE_PROTOCOLS.includes(p))) {
    throw new Error('supportedProtocols must be an array of known wire protocols or null');
  }
  return [...new Set(value)] as LlmWireProtocol[];
}

/** Official OpenAI API base URL — the only endpoint where Responses support may be inferred. */
export const OFFICIAL_OPENAI_BASE_URL = 'https://api.openai.com/v1';

/** Minimal URL shape used for strict endpoint checks (global `URL` in Node and browsers). */
declare const URL: new (url: string) => {
  protocol: string;
  host: string;
  pathname: string;
  search: string;
  hash: string;
};

/** Parsed URL projection for endpoint allowlist checks. */
interface ParsedEndpointUrl {
  protocol: string;
  host: string;
  pathname: string;
  search: string;
  hash: string;
}

/**
 * Strictly decide whether `baseUrl` is the official OpenAI API endpoint.
 * Uses URL parsing + an exact-host allowlist; never substring or model-name matching.
 */
export function isOfficialOpenaiBaseUrl(baseUrl: string | undefined | null): boolean {
  if (baseUrl === undefined || baseUrl === null || baseUrl.trim() === '') return true;
  let parsed: ParsedEndpointUrl;
  try {
    parsed = new URL(baseUrl.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.host !== 'api.openai.com') return false;
  const pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.search === '' && parsed.hash === '' && pathname === '/v1';
}

/**
 * Protocols inferred from providerType/baseUrl when a profile does not declare
 * `supportedProtocols`. Never used for `openai-codex` (OAuth semantics are not
 * an API-key Responses capability) or unknown provider types.
 */
export function inferLlmWireProtocols(
  providerType: string,
  baseUrl?: string | null
): LlmWireProtocol[] {
  if (providerType === 'anthropic') return ['anthropic-messages'];
  if (providerType === 'openai') {
    return isOfficialOpenaiBaseUrl(baseUrl)
      ? ['openai-completions', 'openai-responses']
      : ['openai-completions'];
  }
  return [];
}

/**
 * Resolve the protocols a profile supports. An explicit `supportedProtocols`
 * array is a complete declaration (after dedupe) — an empty array means the
 * endpoint declares no usable protocol and inference must not be re-applied.
 */
export function resolveLlmProfileProtocols(profile: {
  providerType: string;
  baseUrl?: string | null;
  supportedProtocols?: LlmWireProtocol[] | null;
}): { source: 'declared' | 'inferred'; protocols: LlmWireProtocol[] } {
  if (profile.supportedProtocols != null) {
    const protocols: LlmWireProtocol[] = [];
    for (const protocol of profile.supportedProtocols) {
      if (LLM_WIRE_PROTOCOLS.includes(protocol) && !protocols.includes(protocol)) {
        protocols.push(protocol);
      }
    }
    return { source: 'declared', protocols };
  }
  return {
    source: 'inferred',
    protocols: inferLlmWireProtocols(profile.providerType, profile.baseUrl),
  };
}

/**
 * Per-model upstream dialect presets. Values align with pi-ai provider ids so
 * a dialect maps 1:1 onto pi-ai's compat auto-detection. 'openai' means
 * "force plain OpenAI behavior, no quirks" (escape hatch for normalizing
 * proxies). Absent dialect = Auto (infer from providerType / registry hit).
 */
export const LLM_MODEL_DIALECTS = [
  'moonshotai',
  'deepseek',
  'zai',
  'together',
  'openrouter',
  'xai',
  'openai',
] as const;

export type LlmModelDialect = (typeof LLM_MODEL_DIALECTS)[number];

export type CacheRetentionSetting = 'none' | 'short' | 'long';
export type ModelInputModality = 'text' | 'image';

export interface LlmProfileCompat {
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  supportsStrictMode?: boolean;
  /**
   * Anthropic-style `cache_control` markers on openai-compat requests.
   * Set to 'anthropic' when routing Claude models through an
   * OpenAI-compatible proxy so prompt caching still works.
   */
  cacheControlFormat?: 'anthropic';
}

export interface LlmProfileModelEntry {
  /** pi-ai model id, e.g. "claude-opus-4-7". Unique within a profile. */
  modelId: string;
  /** Optional human-readable label shown in UI. Falls back to modelId. */
  displayName?: string;
  /** Declared input modalities for custom/proxy models. Undefined → use registry/default model metadata. */
  inputModalities?: ModelInputModality[];
  /** Override pi-ai's default context window. Positive integer; falsy/undefined → use registry default. */
  contextWindow?: number;
  /** Override pi-ai's default max output tokens. Positive integer. */
  maxTokens?: number;
  /**
   * Upstream provider dialect. Forces provider-specific request shaping
   * (pi-ai compat quirks + tool-schema normalization) regardless of baseUrl —
   * the escape hatch for proxies that mask the real upstream. Absent = Auto.
   */
  dialect?: LlmModelDialect;
}

/**
 * OAuth credentials for `providerType === 'openai-codex'`. Shape matches
 * pi-ai's `OAuthCredentials`. Null/undefined → not authenticated. Refreshed
 * in-memory; persisted only when pi-ai returns rotated values.
 */
export interface CodexOAuthCredentials {
  access: string;
  refresh: string;
  /** ms epoch (Date.now()-compatible) */
  expires: number;
  accountId: string;
}

export interface LlmProfileConfig {
  id: string;
  name: string;
  providerType: LlmProviderType;
  baseUrl?: string;
  apiKey?: string;
  compat?: LlmProfileCompat;
  /**
   * Extra HTTP headers added to LLM API requests. Server-side validation
   * rejects Authorization / Content-Type / Host (case-insensitive) since
   * those are managed by pi-ai and the apiKey field.
   */
  requestHeaders?: Record<string, string>;
  /**
   * Models declared as available on this profile's endpoint. Empty / undefined
   * means the runtime relies on pi-ai registry / hardcoded defaults for whatever
   * model id the agent profile picks (and shows a soft warning in the UI).
   */
  models?: LlmProfileModelEntry[];
  oauthCredentials?: CodexOAuthCredentials;
  /**
   * Explicit endpoint protocol capabilities. When present this is a complete
   * declaration (an empty array means no usable protocol — inference is not
   * re-applied); when absent, protocols are inferred from providerType/baseUrl.
   * Does not change how the built-in pi transport picks its protocol.
   */
  supportedProtocols?: LlmWireProtocol[] | null;
  /**
   * Prompt cache retention preference. Absent ⇒ pi-ai default ('short',
   * 5-minute TTL). 'long' = 1h TTL (higher cache-write cost); 'none' =
   * no cache_control markers (escape hatch for proxies that reject them).
   */
  cacheRetention?: CacheRetentionSetting;
  isDefault?: boolean;
  /** Computed on read for display; not persisted. */
  recordStatus?: RecordStatus;
  createdAt: number;
  updatedAt: number;
}
