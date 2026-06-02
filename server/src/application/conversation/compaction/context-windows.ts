/**
 * Hardcoded model id → context window (token cap).
 * Source of truth: each provider's published model spec at integration time.
 * Update when adding new models. FALLBACK covers unknown ids.
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4-7': 200_000,
  'claude-sonnet-4-6': 200_000,
  // Bare and date-suffixed forms; agent_profiles.model defaults to bare ids elsewhere
  // in the codebase, so listing both forms avoids silent fallback to 100k.
  'claude-haiku-4-5': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  'gpt-5': 400_000,
};

const FALLBACK_CONTEXT_WINDOW = 100_000;

/**
 * Resolve the effective context window for a session/agent profile. Order:
 * 1. `profile.contextWindow` (user override) — used when non-null and > 0
 * 2. `MODEL_CONTEXT_WINDOWS[profile.model]` (hardcoded table)
 * 3. `FALLBACK_CONTEXT_WINDOW`
 *
 * Pass `modelOverride` to resolve a window without a profile object (e.g.
 * one-off compaction call sites).
 */
export function resolveContextWindow(
  profile: { model: string; contextWindow?: number | null } | null,
  modelOverride?: string,
): number {
  if (profile?.contextWindow != null && profile.contextWindow > 0) {
    return profile.contextWindow;
  }
  const modelId = profile?.model ?? modelOverride;
  if (modelId && MODEL_CONTEXT_WINDOWS[modelId]) {
    return MODEL_CONTEXT_WINDOWS[modelId];
  }
  return FALLBACK_CONTEXT_WINDOW;
}
