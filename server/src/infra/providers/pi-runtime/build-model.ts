import type { Model } from '@earendil-works/pi-ai';
import type { LlmProfileConfig, LlmProfileModelEntry } from '@zclaudia/shared/core/llm-profile';
import { tryGetRegistryModel, findInRegistryCrossProvider, type RegistryHit } from './registry-search.js';

const DEFAULT_PROVIDER = 'anthropic';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

/**
 * Default context window for the openai-compat literal path (no registry
 * hit, no per-model override). Mirrors what most OpenAI-compatible proxies
 * advertise — generous enough not to clip mid-stream, conservative enough
 * to keep compaction triggers sensible.
 */
const OPENAI_COMPAT_DEFAULT_CONTEXT_WINDOW = 128_000;
/** Default max output tokens for the openai-compat literal path. */
const OPENAI_COMPAT_DEFAULT_MAX_TOKENS = 8_192;

/**
 * Apply per-model overrides declared on the LLM profile's `models[]` to the
 * already-constructed pi-ai `Model` literal. Mutates in place — callers pass
 * locally-cloned models (registry path shallow-clones; openai-compat path
 * literally constructs the model object), so the mutation is contained.
 *
 * Only positive integers for contextWindow / maxTokens are honored (the routes
 * validator enforces this, but we double-check here so direct callers that
 * skip validation can't accidentally zero out the window).
 */
function applyModelEntryOverrides(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: Model<any>,
  entry: LlmProfileModelEntry | undefined,
): void {
  if (!entry) return;
  if (entry.contextWindow && entry.contextWindow > 0) {
    model.contextWindow = entry.contextWindow;
  }
  if (entry.maxTokens && entry.maxTokens > 0) {
    model.maxTokens = entry.maxTokens;
  }
  if (entry.displayName) {
    model.name = entry.displayName;
  }
}

/**
 * Build a plain openai-compat `Model` literal for the path where neither
 * same-provider nor cross-provider registry lookup matched. Default window /
 * tokens are conservative; callers can still override via `models[*]`.
 */
function buildOpenAiCompatLiteral(
  modelId: string,
  providerType: string,
  profile: LlmProfileConfig | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Model<any> {
  // baseUrl resolution: profile.baseUrl wins, then OPENAI_BASE_URL env
  // (dev-time knob exposed by scripts/dev/start-app.sh), then the
  // canonical openai upstream as a final default so the literal stays
  // well-typed.
  const baseUrl = profile?.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model: Model<any> = {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider: providerType,
    baseUrl,
    // `reasoning: true` makes pi-ai's openai-completions provider gate the
    // thinkingFormat-specific "enable thinking" knobs (deepseek/zai/qwen/
    // openrouter/together/string-thinking) on `options.reasoning`. Setting
    // false would silently disable thinking for ALL reasoning-style providers
    // regardless of agentProfile.thinkingLevel. When the user hasn't set
    // thinkingLevel, options.reasoning is undefined and pi sends no
    // thinking-related params (see openai-completions.js:345-346) — so
    // `true` is safe even for non-reasoning models.
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: OPENAI_COMPAT_DEFAULT_CONTEXT_WINDOW,
    maxTokens: OPENAI_COMPAT_DEFAULT_MAX_TOKENS,
  };
  if (profile?.compat) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (model as any).compat = profile.compat;
  }
  return model;
}

/**
 * Result of {@link buildModel}: a pi-ai `Model` literal plus an optional
 * `getApiKey` callback that pi-agent-core invokes lazily when issuing API
 * requests. The callback is only set when an explicit api key is available
 * (profile or env); otherwise pi falls back to its own resolution.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BuiltModel = { model: Model<any>; getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined };

/**
 * Build a pi-ai `Model` literal from an optional {@link LlmProfileConfig} and
 * an optional model-id override. Resolution order: `modelOverride` > env >
 * hardcoded default.
 *
 * Lookup strategy (replaces the legacy "if baseUrl, short-circuit to
 * openai-compat literal" logic):
 *
 *   1. Same-provider registry lookup — `getModel(providerType, modelId)`.
 *      Catches the common case (providerType=anthropic + modelId is a
 *      registered Claude model, etc.).
 *
 *   2. Cross-provider registry sweep — only when (1) misses. Handles the
 *      OpenAI-compat proxy case: user sets providerType=`openai` +
 *      baseUrl=<their proxy> and routes (say) `deepseek-v4-flash` through
 *      it. Same-provider lookup misses (no `deepseek-v4-flash` under
 *      `openai`), but the cross-provider sweep finds it under `deepseek`
 *      and surfaces the real 1M context window instead of the
 *      openai-compat 128k default.
 *
 *   3. openai-compat literal — final fallback when no registry entry
 *      matches. Defaults: 128k contextWindow, 8k maxTokens.
 *
 * On a registry hit (1) or (2), the registry model literal is shallow-cloned
 * and the network/protocol fields are overridden:
 *   - `baseUrl` ← profile.baseUrl (if set), so the request hits the user's
 *     proxy instead of the upstream provider's canonical endpoint.
 *   - `api` ← derived from providerType (anthropic →
 *     `anthropic-completion`, everything else → `openai-completions`), so a
 *     model registered under `deepseek` (api: `openai-completions`) reached
 *     via providerType=`anthropic` still serializes correctly. In practice
 *     providerType drives the wire shape; only the contextWindow / cost /
 *     reasoning metadata is borrowed from the registry.
 *
 * `modelEntry` carries per-model overrides (contextWindow / maxTokens /
 * displayName) declared on `profile.models[]`. Applied last so they always
 * win over registry defaults and the openai-compat literal's hardcoded
 * window / maxTokens. Resolvers (e.g. `resolveContextWindow`) look up the
 * entry by `modelId` and pass it here so any downstream code reading
 * `model.contextWindow` sees the user-declared value.
 */
export function buildModel(
  profile?: LlmProfileConfig,
  modelOverride?: string,
  modelEntry?: LlmProfileModelEntry,
): BuiltModel {
  // providerType resolution:
  //   1. profile.providerType (canonical surface — set by the LLM-profile editor)
  //   2. PI_PROVIDER env (dev-time knob)
  //   3. OPENAI_BASE_URL env implies `openai` providerType when no profile
  //      is given (the env knob is itself a declaration that the user is
  //      pointing at an openai-compat endpoint)
  //   4. DEFAULT_PROVIDER (`anthropic`)
  const providerType =
    profile?.providerType
    ?? process.env.PI_PROVIDER
    ?? (process.env.OPENAI_BASE_URL ? 'openai' : DEFAULT_PROVIDER);
  // OPENAI_MODEL is a legacy env knob from the dev scripts that survives
  // alongside PI_MODEL; honour it as a secondary fallback when no profile
  // override is supplied. PI_MODEL still wins to keep the documented dev
  // env surface predictable.
  const modelId = modelOverride
    ?? process.env.PI_MODEL
    ?? process.env.OPENAI_MODEL
    ?? DEFAULT_MODEL;

  // 1) same-provider lookup; 2) cross-provider sweep.
  const registryHit: RegistryHit | undefined =
    tryGetRegistryModel(providerType, modelId) ?? findInRegistryCrossProvider(modelId);

  // OPENAI_BASE_URL is a dev-time env knob (see scripts/dev/start-app.sh)
  // — when set without a profile it should still flip the request to that
  // endpoint regardless of which lookup path produced the model literal.
  const envBaseUrl = profile?.baseUrl ?? process.env.OPENAI_BASE_URL;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let model: Model<any>;
  if (registryHit) {
    // Shallow-clone so mutations don't leak across consumers (pi-ai caches
    // the literal instance at module scope).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model = { ...(registryHit.model as any) };
    // Override network / protocol fields so the request lands on the user's
    // proxy with the wire shape their providerType dictates.
    if (envBaseUrl) {
      model.baseUrl = envBaseUrl;
    }
    // Stamp the wire api based on providerType: anthropic native uses the
    // `anthropic-messages` API; everything else (openai/deepseek/openrouter/
    // azure-openai/etc. running through an openai-compatible proxy) uses
    // `openai-completions`. This overrides whatever `api` the registry
    // entry declared so an entry registered under (say) `deepseek` reached
    // via providerType=`openai` serializes correctly.
    model.api = providerType === 'anthropic' ? 'anthropic-messages' : 'openai-completions';
    // Forward the user-declared providerType as the `provider` field; pi-ai
    // uses this for env-var key derivation and compat tagging downstream.
    model.provider = providerType;
    // For openai-compat paths, force `reasoning: true` so pi-ai's
    // openai-completions provider gates thinkingFormat-specific knobs on
    // `options.reasoning` rather than silently disabling thinking for all
    // reasoning-style providers. Anthropic native path leaves the registry
    // value alone.
    if (model.api === 'openai-completions') {
      model.reasoning = true;
    }
    if (profile?.compat) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (model as any).compat = profile.compat;
    }
  } else {
    // No registry match — fall back to a literal openai-compat shape. Works
    // for unregistered model ids served via OpenAI-compatible endpoints.
    model = buildOpenAiCompatLiteral(modelId, providerType, profile);
  }

  if (profile?.requestHeaders) {
    model.headers = { ...(model.headers ?? {}), ...profile.requestHeaders };
  }
  applyModelEntryOverrides(model, modelEntry);

  // API key resolution priority:
  //   1. Explicit `profile.apiKey` always wins (the editor is the canonical
  //      surface for credentials).
  //   2. When `OPENAI_BASE_URL` is set (dev-time env knob), surface
  //      `OPENAI_API_KEY` so the openai-compat path has a key even when
  //      there's no profile.
  //   3. When no registry hit landed (literal openai-compat path), still
  //      surface `OPENAI_API_KEY` as a sane secondary source.
  //   4. Otherwise leave `getApiKey` undefined and let pi-ai own env
  //      resolution for known providers (ANTHROPIC_API_KEY etc.).
  let getApiKey: BuiltModel['getApiKey'];
  if (profile?.apiKey) {
    getApiKey = async () => profile.apiKey!;
  } else if (process.env.OPENAI_BASE_URL || !registryHit) {
    getApiKey = async () => process.env.OPENAI_API_KEY ?? '';
  }

  return { model, getApiKey };
}
