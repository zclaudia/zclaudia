// LLM connection profile types (replaces the old `provider.ts` profile shape).

export const LLM_PROVIDER_TYPES = [
  'anthropic',
  'openai',
  'openai-custom',
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
  isDefault?: boolean;
  createdAt: number;
  updatedAt: number;
}
