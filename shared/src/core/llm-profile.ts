// LLM connection profile types (replaces the old `provider.ts` profile shape).

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
   * Prompt cache retention preference. Absent ⇒ pi-ai default ('short',
   * 5-minute TTL). 'long' = 1h TTL (higher cache-write cost); 'none' =
   * no cache_control markers (escape hatch for proxies that reject them).
   */
  cacheRetention?: CacheRetentionSetting;
  isDefault?: boolean;
  createdAt: number;
  updatedAt: number;
}
