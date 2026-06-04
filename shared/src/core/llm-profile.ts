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
  isDefault?: boolean;
  createdAt: number;
  updatedAt: number;
}
