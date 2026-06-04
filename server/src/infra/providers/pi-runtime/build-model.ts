import { getModel, type Model } from '@earendil-works/pi-ai';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';

const DEFAULT_PROVIDER = 'anthropic';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

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
 * an optional model-id override. Resolution order: `modelOverride` > profile
 * field > env > hardcoded default.
 *
 * If `baseUrl` is set (via profile or `OPENAI_BASE_URL` env) we build a custom
 * `openai-completions` Model literal so any OpenAI-compatible endpoint
 * (DeepSeek / vLLM / Azure / corporate proxies / etc.) works without being
 * pre-registered in pi-ai's model registry.
 */
export function buildModel(profile?: LlmProfileConfig, modelOverride?: string): BuiltModel {
  const baseUrl = profile?.baseUrl ?? process.env.OPENAI_BASE_URL;
  if (baseUrl) {
    const id = modelOverride ?? process.env.OPENAI_MODEL ?? 'gpt-4o';
    const provider = profile?.providerType ?? process.env.PI_PROVIDER ?? 'openai-custom';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model: Model<any> = {
      id,
      name: id,
      api: 'openai-completions',
      provider,
      baseUrl,
      // `reasoning: true` makes pi-ai's openai-completions provider gate the
      // thinkingFormat-specific "enable thinking" knobs (deepseek/zai/qwen/
      // openrouter/together/string-thinking) on `options.reasoning`. Setting
      // false would silently disable thinking for ALL reasoning-style
      // providers regardless of agentProfile.thinkingLevel. When the user
      // hasn't set thinkingLevel, options.reasoning is undefined and pi
      // sends no thinking-related params (see openai-completions.js:345-346)
      // — so `true` is safe even for non-reasoning models.
      reasoning: true,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    };
    if (profile?.compat) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (model as any).compat = profile.compat;
    }
    if (profile?.requestHeaders) {
      model.headers = { ...(model.headers ?? {}), ...profile.requestHeaders };
    }
    return {
      model,
      getApiKey: async () => profile?.apiKey ?? process.env.OPENAI_API_KEY ?? '',
    };
  }

  const provider = profile?.providerType ?? process.env.PI_PROVIDER ?? DEFAULT_PROVIDER;
  const modelId = modelOverride ?? process.env.PI_MODEL ?? DEFAULT_MODEL;
  // pi-ai's getModel is generically typed on literal provider + model id.
  // Env-derived strings can't satisfy those generic constraints; cast through `string`
  // to erase the generic and let the runtime registry lookup do the work.
  // Model<T> requires T extends Api, so we use `any` to opt out of that constraint.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (getModel as (provider: string, model: string) => Model<any>)(provider, modelId);
  if (profile?.requestHeaders) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (model as any).headers = { ...((model as any).headers ?? {}), ...profile.requestHeaders };
  }
  return {
    model,
    getApiKey: profile?.apiKey ? async () => profile.apiKey! : undefined,
  };
}
