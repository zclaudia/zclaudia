import { buildModel } from '../../../infra/providers/pi-runtime/build-model.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { ContextWindowSource } from '@zclaudia/shared/wire/messages/core';

export type { ContextWindowSource };

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
 * Result of {@link resolveContextWindow}. `value` is the effective context
 * window in tokens; `source` documents which layer in the resolution chain
 * supplied it (so the UI can render provenance and warn on `fallback`).
 */
export interface ResolvedContextWindow {
  value: number;
  source: ContextWindowSource;
}

/**
 * Resolve the effective context window for a session. Priority chain:
 *
 * 1. `llmProfileConfig.models[*].contextWindow` — user-declared per-profile
 *    override (`profile_entry`). Same model id can carry different real
 *    windows across providers/tiers (e.g. Anthropic Claude vs an OpenRouter
 *    proxy), so this is the canonical source-of-truth when set.
 * 2. `MODEL_CONTEXT_WINDOWS[modelId]` — server's hardcoded table
 *    (`hardcoded_table`) for first-party ids so freshly-installed setups
 *    work without manual override.
 * 3. `buildModel(llmProfileConfig, modelId).model.contextWindow` — pi-ai
 *    registry lookup (built-in providers) or openai-compat literal default
 *    (custom endpoints) — both reported as `pi_ai_registry` since they
 *    represent "whatever the model literal advertises".
 * 4. `FALLBACK_CONTEXT_WINDOW` (100k) — last-resort safety net (`fallback`).
 *    Surfaced so UI can warn that the displayed limit may be wrong.
 *
 * Note: the legacy `agent_profile.contextWindow` override level has been
 * dropped — the override now lives on the LLM profile via `models[*]`. Pass
 * `modelOverride` to resolve without an agent profile (e.g. one-off compaction
 * call sites).
 */
export function resolveContextWindow(
  agentProfile: { model: string } | null,
  modelOverride?: string,
  llmProfileConfig?: LlmProfileConfig,
): ResolvedContextWindow {
  const modelId = agentProfile?.model ?? modelOverride;

  if (modelId && llmProfileConfig?.models) {
    const entry = llmProfileConfig.models.find((m) => m.modelId === modelId);
    if (entry?.contextWindow && entry.contextWindow > 0) {
      return { value: entry.contextWindow, source: 'profile_entry' };
    }
  }
  if (modelId && MODEL_CONTEXT_WINDOWS[modelId]) {
    return { value: MODEL_CONTEXT_WINDOWS[modelId], source: 'hardcoded_table' };
  }
  if (llmProfileConfig || modelId) {
    try {
      const built = buildModel(llmProfileConfig, modelId);
      if (built.model.contextWindow > 0) {
        return { value: built.model.contextWindow, source: 'pi_ai_registry' };
      }
    } catch {
      // buildModel may throw for unknown providers; fall through.
    }
  }
  return { value: FALLBACK_CONTEXT_WINDOW, source: 'fallback' };
}
