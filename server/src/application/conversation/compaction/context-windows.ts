import { tryGetRegistryModel, findInRegistryCrossProvider } from '../../../infra/providers/pi-runtime/registry-search.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { ContextWindowSource } from '@zclaudia/shared/wire/messages/core';

export type { ContextWindowSource };

const FALLBACK_CONTEXT_WINDOW = 100_000;
/**
 * Mirror of build-model.ts's openai-compat literal default. Kept in sync so
 * `resolveContextWindow` reports the same number that `buildModel` would
 * actually produce, without depending on buildModel (which would cycle
 * through the api-key resolver and `Model` literal construction we don't
 * need for a window lookup).
 */
const OPENAI_COMPAT_DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_PROVIDER = 'anthropic';

/**
 * Result of {@link resolveContextWindow}. `value` is the effective context
 * window in tokens; `source` documents which layer in the resolution chain
 * supplied it (so the UI can render provenance and warn on `fallback`);
 * `matchedProvider` is set whenever the value came from the pi-ai registry
 * so the UI can render "from registry (deepseek)" etc.
 */
export interface ResolvedContextWindow {
  value: number;
  source: ContextWindowSource;
  /** Only set when source === 'pi_ai_registry'. The pi-ai registry provider
   *  id that matched the requested model id (same-provider hit reports the
   *  configured providerType; cross-provider hit reports the discovered
   *  provider). */
  matchedProvider?: string;
}

/**
 * Resolve the effective context window for a session. Priority chain:
 *
 *   1. `llmProfileConfig.models[*].contextWindow` — user-declared per-profile
 *      override (`profile_entry`). Same model id can carry different real
 *      windows across providers/tiers (e.g. Anthropic Claude vs an
 *      OpenRouter proxy), so this is the canonical source-of-truth when set.
 *
 *   2. Same-provider pi-ai registry lookup (`pi_ai_registry`). Catches the
 *      common case where the user's providerType matches the pi-ai provider
 *      that ships the model spec.
 *
 *   3. Cross-provider pi-ai registry sweep (`pi_ai_registry` + matchedProvider).
 *      Handles the OpenAI-compat proxy case: providerType=`openai`, modelId
 *      `deepseek-v4-flash` — same-provider misses but the sweep finds the
 *      entry under `deepseek` and surfaces the real window.
 *
 *   4. openai-compat literal default 128k (`openai_compat_default`). Set
 *      explicitly so the UI can distinguish "registry says this" from "we
 *      assumed the standard openai-compat window because nothing matched".
 *
 *   5. {@link FALLBACK_CONTEXT_WINDOW} 100k — last-resort safety net
 *      (`fallback`). Surfaced so UI can warn that the displayed limit may
 *      be wrong.
 *
 * Note: the legacy MODEL_CONTEXT_WINDOWS hardcoded table was dropped — the
 * pi-ai registry is the single source of truth for first-party model specs.
 * The `agent_profile.contextWindow` override level was already dropped in
 * earlier migrations; the override now lives on the LLM profile via
 * `models[*]`. Pass `modelOverride` to resolve without an agent profile
 * (e.g. one-off compaction call sites).
 */
export function resolveContextWindow(
  agentProfile: { model: string } | null,
  modelOverride?: string,
  llmProfileConfig?: LlmProfileConfig,
): ResolvedContextWindow {
  const modelId = agentProfile?.model ?? modelOverride;
  const providerType = llmProfileConfig?.providerType ?? DEFAULT_PROVIDER;

  if (modelId && llmProfileConfig?.models) {
    const entry = llmProfileConfig.models.find((m) => m.modelId === modelId);
    if (entry?.contextWindow && entry.contextWindow > 0) {
      return { value: entry.contextWindow, source: 'profile_entry' };
    }
  }

  if (modelId) {
    const sameProviderHit = tryGetRegistryModel(providerType, modelId);
    if (sameProviderHit && (sameProviderHit.model.contextWindow ?? 0) > 0) {
      return {
        value: sameProviderHit.model.contextWindow,
        source: 'pi_ai_registry',
        matchedProvider: sameProviderHit.provider,
      };
    }
    const crossProviderHit = findInRegistryCrossProvider(modelId);
    if (crossProviderHit && (crossProviderHit.model.contextWindow ?? 0) > 0) {
      return {
        value: crossProviderHit.model.contextWindow,
        source: 'pi_ai_registry',
        matchedProvider: crossProviderHit.provider,
      };
    }
  }

  // Only the openai-compat code path defaults to 128k; the pure-anthropic
  // path with an unregistered model id should fall through to the
  // last-resort 100k fallback (we have no informed estimate). Treat any
  // non-anthropic providerType as an openai-compat consumer.
  if (providerType !== 'anthropic') {
    return { value: OPENAI_COMPAT_DEFAULT_CONTEXT_WINDOW, source: 'openai_compat_default' };
  }

  return { value: FALLBACK_CONTEXT_WINDOW, source: 'fallback' };
}
