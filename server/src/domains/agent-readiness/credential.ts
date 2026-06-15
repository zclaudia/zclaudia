import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';

function nonEmpty(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * Profile-only credential check: the llm-profile is the single source of truth.
 * Env credentials are materialized onto profiles at startup (see
 * resolveEnvCredential / autoDetectProviders), so this never reads env — readiness
 * reflects exactly what is stored on (and editable in) the profile.
 */
export function hasLlmCredential(profile: LlmProfileConfig): boolean {
  if (profile.providerType === 'openai-codex') {
    return nonEmpty(profile.oauthCredentials?.access);
  }
  return nonEmpty(profile.apiKey);
}
