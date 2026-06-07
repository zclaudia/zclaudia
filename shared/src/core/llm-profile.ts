// LLM connection profile types (replaces the old `provider.ts` profile shape).

/**
 * Canonical LLM provider type list. `openai-custom` was merged into `openai`
 * in migration 004 — both shapes had identical wire behaviour (the only
 * difference was whether `baseUrl` was required). The merged `openai` entry
 * accepts an optional baseUrl; when absent the runtime defaults to
 * `https://api.openai.com/v1`.
 */
export const LLM_PROVIDER_TYPES = [
  'anthropic',
  'openai',
  'openai-codex',
] as const;

export type LlmProviderType = typeof LLM_PROVIDER_TYPES[number] | string;

export interface LlmProfileCompat {
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  supportsStrictMode?: boolean;
}

export interface LlmProfileModelEntry {
  /** pi-ai model id, e.g. "claude-opus-4-7". Unique within a profile. */
  modelId: string;
  /** Optional human-readable label shown in UI. Falls back to modelId. */
  displayName?: string;
  /** Override pi-ai's default context window. Positive integer; falsy/undefined → use registry default. */
  contextWindow?: number;
  /** Override pi-ai's default max output tokens. Positive integer. */
  maxTokens?: number;
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
  isDefault?: boolean;
  createdAt: number;
  updatedAt: number;
}
