/** Default model id when no profile override or env knob is set. */
export const DEFAULT_MODEL = 'claude-sonnet-4-6';

/**
 * Resolve the model id implied by the dev-time env knobs, mirroring buildModel's
 * fallback chain: PI_MODEL wins, then the legacy OPENAI_MODEL (exposed by
 * scripts/dev/start-app.sh), then the hardcoded default.
 *
 * Used both at runtime (buildModel) and when seeding the default agent profile,
 * so a freshly seeded agent's model matches what the runtime would actually
 * request. Without this, the seed would hardcode an Anthropic model against an
 * openai-compat endpoint (e.g. a local kimi proxy), producing an agent that
 * passes the credential check but fails at first message with model_not_found.
 */
export function resolveEnvModel(): string {
  return process.env.PI_MODEL ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
}
