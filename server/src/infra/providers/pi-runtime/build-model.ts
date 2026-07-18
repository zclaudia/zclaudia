import type { Model } from '@earendil-works/pi-ai';
import {
  LLM_MODEL_DIALECTS,
  type LlmModelDialect,
  type LlmProfileConfig,
  type LlmProfileModelEntry,
} from '@zclaudia/shared/core/llm-profile';
import {
  tryGetRegistryModel,
  findInRegistryCrossProvider,
  type RegistryHit,
} from './registry-search.js';
import { refreshIfNeeded } from '../../../domains/llm-profiles/codex-oauth-service.js';
import { getLlmProfileWriter } from '../../../domains/llm-profiles/repository-registry.js';
import { resolveEnvModel } from './env-model.js';

const DEFAULT_PROVIDER = 'anthropic';

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
  entry: LlmProfileModelEntry | undefined
): void {
  if (!entry) return;
  if (entry.contextWindow && entry.contextWindow > 0) {
    model.contextWindow = entry.contextWindow;
  }
  if (entry.maxTokens && entry.maxTokens > 0) {
    model.maxTokens = entry.maxTokens;
  }
  if (entry.inputModalities && entry.inputModalities.length > 0) {
    model.input = [...entry.inputModalities];
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
/**
 * True for OpenAI-compatible endpoints that are NOT the canonical OpenAI API.
 * Third-party proxies (LiteLLM, one-api, vLLM, self-hosted gateways, …) almost
 * universally accept only the `system` role for the system prompt and reject
 * OpenAI's `developer` role with `unknown variant 'developer'`. The canonical
 * api.openai.com keeps developer-role support (pi-ai auto-detects it).
 */
function isThirdPartyOpenAiCompat(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    return new URL(baseUrl).host.toLowerCase() !== 'api.openai.com';
  } catch {
    // A non-URL baseUrl should never reach here, but if it does treat it as a
    // third-party endpoint — the safe (system-role) default.
    return true;
  }
}

function buildOpenAiCompatLiteral(
  modelId: string,
  providerType: string,
  profile: LlmProfileConfig | undefined
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

export type BuiltModel = {
  model: Model<any>;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
};

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
/**
 * Resolve the effective dialect for a model. Explicit entry dialect wins.
 * In Auto mode, a cross-provider registry hit whose provider is a known
 * dialect is inherited (e.g. `deepseek-v4-flash` behind a generic proxy) —
 * restricted to the allowlist so oddball registry providers with pi-ai
 * side-effect branches (github-copilot, cloudflare-*, anthropic, …) can
 * never leak into `model.provider`.
 */
function resolveDialect(
  entry: LlmProfileModelEntry | undefined,
  registryHit: RegistryHit | undefined,
  providerType: string
): LlmModelDialect | undefined {
  if (entry?.dialect) return entry.dialect;
  if (
    registryHit &&
    registryHit.provider !== providerType &&
    (LLM_MODEL_DIALECTS as readonly string[]).includes(registryHit.provider)
  ) {
    return registryHit.provider as LlmModelDialect;
  }
  return undefined;
}

export function buildModel(
  profile?: LlmProfileConfig,
  modelOverride?: string,
  modelEntry?: LlmProfileModelEntry
): BuiltModel {
  // providerType resolution:
  //   1. profile.providerType (canonical surface — set by the LLM-profile editor)
  //   2. PI_PROVIDER env (dev-time knob)
  //   3. OPENAI_BASE_URL env implies `openai` providerType when no profile
  //      is given (the env knob is itself a declaration that the user is
  //      pointing at an openai-compat endpoint)
  //   4. DEFAULT_PROVIDER (`anthropic`)
  const providerType =
    profile?.providerType ??
    process.env.PI_PROVIDER ??
    (process.env.OPENAI_BASE_URL ? 'openai' : DEFAULT_PROVIDER);
  // When no explicit override is supplied, fall back to the dev-time env knobs
  // (PI_MODEL wins, then the legacy OPENAI_MODEL, then the default). Shared with
  // the default-agent seed so a seeded agent's model matches what we request.
  const modelId = modelOverride ?? resolveEnvModel();

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
    if (envBaseUrl && providerType !== 'openai-codex') {
      model.baseUrl = envBaseUrl;
    }
    // Stamp the wire api based on providerType: anthropic native uses the
    // `anthropic-messages` API; everything else (openai/deepseek/openrouter/
    // azure-openai/etc. running through an openai-compatible proxy) uses
    // `openai-completions`. This overrides whatever `api` the registry
    // entry declared so an entry registered under (say) `deepseek` reached
    // via providerType=`openai` serializes correctly.
    if (providerType === 'anthropic') {
      model.api = 'anthropic-messages';
    } else if (providerType === 'openai-codex') {
      model.api = 'openai-codex-responses';
    } else {
      model.api = 'openai-completions';
    }
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

  // Dialect: force the upstream family so pi-ai's detectCompat activates the
  // full quirk bundle even behind proxies that mask the real provider. The
  // stamp itself is wire-agnostic (read by tool-schema-compat); the provider
  // override only applies to the openai-completions wire — anthropic/codex
  // providers use `provider` for OAuth/key/header logic and stay untouched.
  const dialect = resolveDialect(modelEntry, registryHit, providerType);
  if (dialect) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (model as any).dialect = dialect;
    if (model.api === 'openai-completions') {
      model.provider = dialect;
    }
  }

  // Third-party openai-compatible proxies only support the `system` role for the
  // system prompt. Because every openai-completions path above forces
  // `reasoning: true`, pi-ai's compat auto-detection would emit the `developer`
  // role for any proxy host it doesn't recognize (`useDeveloperRole =
  // reasoning && supportsDeveloperRole`), which those proxies reject with
  // `unknown variant 'developer'`. Pin supportsDeveloperRole=false for
  // non-canonical openai endpoints unless the profile explicitly overrides it.
  // Registry entries that hard-code the flag (e.g. moonshotai) and canonical
  // api.openai.com are untouched; other registry compat fields are preserved.
  if (
    model.api === 'openai-completions' &&
    isThirdPartyOpenAiCompat(model.baseUrl) &&
    profile?.compat?.supportsDeveloperRole === undefined
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (model as any).compat = { ...((model as any).compat ?? {}), supportsDeveloperRole: false };
  }

  if (profile?.requestHeaders && profile.providerType !== 'openai-codex') {
    model.headers = { ...(model.headers ?? {}), ...profile.requestHeaders };
  }
  if (profile?.providerType === 'openai-codex' && profile.oauthCredentials) {
    model.headers = {
      ...(model.headers ?? {}),
      'ChatGPT-Account-Id': profile.oauthCredentials.accountId,
      'OpenAI-Beta': 'responses=experimental',
      originator: 'zclaudia',
    };
  }
  applyModelEntryOverrides(model, modelEntry);

  // API key resolution: the llm-profile is the single source of truth.
  //   1. openai-codex → OAuth access token (refreshed).
  //   2. Explicit `profile.apiKey` (the canonical, editable surface).
  //   3. Otherwise leave `getApiKey` undefined. Env credentials are materialized
  //      onto profiles at startup (resolveEnvCredential / autoDetectProviders);
  //      we do not read env for a credential here. pi-ai still owns its own env
  //      fallback for a keyless profile, but that path is unreachable once the
  //      profile carries the key.
  let getApiKey: BuiltModel['getApiKey'];
  if (profile?.providerType === 'openai-codex') {
    getApiKey = async () => {
      const fresh = await refreshIfNeeded(profile, getLlmProfileWriter());
      return fresh.access;
    };
  } else if (profile?.apiKey) {
    getApiKey = async () => profile.apiKey!;
  }

  return { model, getApiKey };
}
