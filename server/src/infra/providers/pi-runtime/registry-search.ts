import { getModel, getModels, getProviders, type Model } from '@earendil-works/pi-ai/compat';

/**
 * Result of a registry lookup. Returns both the model literal AND the
 * provider id that supplied it so the caller can (a) clone the literal and
 * override network fields (baseUrl, api), and (b) report provenance to the
 * UI ("from registry (deepseek)" vs "from registry (anthropic)").
 */
export interface RegistryHit {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: Model<any>;
  /** pi-ai provider id whose registry entry matched the requested model id. */
  provider: string;
}

/**
 * Same-provider lookup. Wraps `getModel` so callers can treat "not found" as
 * a value instead of catching exceptions. pi-ai's `getModel` is generically
 * typed on the provider+modelId literal types — env-derived strings cannot
 * satisfy those constraints, so we cast through `string` here once and let
 * the runtime registry lookup do the work.
 */
export function tryGetRegistryModel(provider: string, modelId: string): RegistryHit | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = getModel as (p: string, m: string) => Model<any> | undefined;
  const model = fn(provider, modelId);
  return model ? { model, provider } : undefined;
}

/**
 * All registry providers that declare `modelId`, in registry enumeration
 * order. Used for dialect inheritance, which must consider every provider a
 * model is registered under — not just the contextWindow-ranked winner that
 * findInRegistryCrossProvider returns.
 */
export function findRegistryProvidersForModel(modelId: string): string[] {
  const getProvidersFn = getProviders as () => string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getModelsFn = getModels as (p: string) => Model<any>[];
  const providers: string[] = [];
  for (const provider of getProvidersFn()) {
    if (getModelsFn(provider).some(model => model.id === modelId)) {
      providers.push(provider);
    }
  }
  return providers;
}

/**
 * Cross-provider lookup. Sweeps every pi-ai registered provider for a model
 * whose `id` matches `modelId`, ranks the hits by `contextWindow`
 * (largest first), and returns the winner. Designed for the OpenAI-compat
 * proxy scenario where a user routes (say) `deepseek-v4-flash` through a
 * generic openai endpoint — the same-provider lookup with
 * providerType=`openai` misses, so this fallback finds the entry under the
 * `deepseek` provider key and surfaces the correct context window.
 *
 * Tie-breaker: largest contextWindow wins. The same model id can appear
 * under multiple providers (e.g. `gpt-4o` mirrored across openai +
 * openrouter + vercel-ai-gateway) with subtly different windows; picking the
 * largest is the safest default for compaction triggering (a too-large
 * estimate means we trigger compaction later than ideal, but the user can
 * always override via `models[*].contextWindow`).
 */
export function findInRegistryCrossProvider(modelId: string): RegistryHit | undefined {
  const getProvidersFn = getProviders as () => string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getModelsFn = getModels as (p: string) => Model<any>[];

  const matches: RegistryHit[] = [];
  for (const provider of getProvidersFn()) {
    for (const model of getModelsFn(provider)) {
      if (model.id === modelId) {
        matches.push({ model, provider });
      }
    }
  }
  if (matches.length === 0) return undefined;
  matches.sort((a, b) => (b.model.contextWindow ?? 0) - (a.model.contextWindow ?? 0));
  return matches[0];
}
