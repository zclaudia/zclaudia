import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';

function nonEmpty(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * Structural credential check, mirroring build-model.ts's resolution chain so
 * readiness never disagrees with what an actual run requires. Returns true iff a
 * non-empty credential is obtainable for this profile.
 *
 * Generous on unknown provider types (returns true) so we never wrongly block a
 * provider we can't reason about; the run-start error remains the backstop.
 */
export function hasLlmCredential(profile: LlmProfileConfig): boolean {
  if (profile.providerType === 'openai-codex') {
    return nonEmpty(profile.oauthCredentials?.access);
  }
  if (nonEmpty(profile.apiKey)) return true;

  // Env fallback. A custom baseUrl (profile-level or OPENAI_BASE_URL) forces the
  // OpenAI-compat path → OPENAI_API_KEY (build-model.ts:252-253).
  // Note: build-model also surfaces OPENAI_API_KEY on its `!registryHit` arm
  // (unregistered model id, line 252); that's a runtime-lookup detail this pure
  // predicate intentionally does not replicate — the run-start error is the backstop.
  if (nonEmpty(profile.baseUrl) || nonEmpty(process.env.OPENAI_BASE_URL)) {
    return nonEmpty(process.env.OPENAI_API_KEY);
  }
  if (profile.providerType === 'openai') return nonEmpty(process.env.OPENAI_API_KEY);
  if (profile.providerType === 'anthropic') return nonEmpty(process.env.ANTHROPIC_API_KEY);

  // Unknown provider: don't block.
  return true;
}
