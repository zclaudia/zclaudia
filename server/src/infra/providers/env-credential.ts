import type { LlmProviderType } from '@zclaudia/shared/core/llm-profile';

/** A credential materialized from environment variables, ready to write onto an llm-profile. */
export interface EnvCredential {
  providerType: LlmProviderType;
  baseUrl?: string;
  apiKey: string;
}

function nonEmpty(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * The ONE place env LLM credentials are read. Mirrors build-model's provider
 * resolution: a global OPENAI_BASE_URL proxy takes precedence (it routes every
 * request), otherwise a bare ANTHROPIC_API_KEY. Returns null when no usable
 * credential is present. Used only at startup to materialize env → profile;
 * nothing else should read these env vars for a credential decision.
 */
export function resolveEnvCredential(): EnvCredential | null {
  if (nonEmpty(process.env.OPENAI_BASE_URL) && nonEmpty(process.env.OPENAI_API_KEY)) {
    return {
      providerType: 'openai',
      baseUrl: process.env.OPENAI_BASE_URL!.trim(),
      apiKey: process.env.OPENAI_API_KEY!.trim(),
    };
  }
  if (nonEmpty(process.env.ANTHROPIC_API_KEY)) {
    return { providerType: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY!.trim() };
  }
  return null;
}
