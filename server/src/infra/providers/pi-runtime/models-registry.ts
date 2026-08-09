import { Mutex } from 'async-mutex';
import {
  createModels,
  createProvider,
  type Api,
  type AuthResult,
  type Credential,
  type CredentialInfo,
  type CredentialStore,
  type Model,
  type Models,
  type ProviderAuth,
  type ProviderStreams,
} from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAICodexResponsesApi } from '@earendil-works/pi-ai/api/openai-codex-responses.lazy';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import { codexOAuth, toCodexCredentials, toOAuthCredential } from '../../../domains/llm-profiles/codex-oauth-pi.js';
import { getLlmProfileWriter } from '../../../domains/llm-profiles/repository-registry.js';

/**
 * pi 0.84 moved request auth behind a `Models` registry: `stream()` resolves
 * the key by looking `model.provider` up in the registry's providers, and
 * there is no per-call key injection. So every call path needs a `Models`, and
 * the registration id has to be whatever `model.provider` says.
 *
 * That field is doing two jobs at once. `Models.getAuth` treats it as the
 * provider identity, and the wires treat it as a behaviour switch —
 * `openai-completions`' compat detection matches on it (`provider ===
 * "moonshotai"`, `"zai"`, …), which is exactly what our per-model `dialect`
 * writes into it so a generic proxy still gets its upstream's quirks, and
 * `anthropic-messages` branches on `provider === "anthropic"` too.
 *
 * Hence the split below, which follows the grain of the two provider kinds
 * rather than forcing one rule on both:
 *
 * - **OAuth (Codex)** registers under the *profile id*, because the credential
 *   is per profile and pi's refresh lock is per registration — two profiles
 *   sharing one slot would clobber each other's tokens, and a shared slot
 *   would defeat the lock that stops a rotated refresh token being spent
 *   twice. Safe to rename: the codex wire only reads `model.provider` for
 *   error text, and a Codex model never carries a dialect (the dialect stamp
 *   is gated on the `openai-completions` wire).
 *
 * - **API key** registers under the provider string the model already carries,
 *   dialect included, so detection keeps working. Two profiles of the same
 *   type would collide on that id, so these registries are keyed per profile
 *   and hold exactly one provider. There is no refresh and therefore no lock
 *   to share, which is why the collision costs nothing here.
 */

/** The wire implementations we can register, keyed by `model.api`. */
const API_STREAMS: Record<string, () => ProviderStreams> = {
  'anthropic-messages': anthropicMessagesApi,
  'openai-completions': openAICompletionsApi,
  'openai-codex-responses': openAICodexResponsesApi,
};

function streamsFor(api: string): ProviderStreams {
  const factory = API_STREAMS[api] ?? openAICompletionsApi;
  return factory();
}

/**
 * `CredentialStore` over one LLM profile's row.
 *
 * pi requires `modify` to be the only write path and to be serialized, because
 * `Models.getAuth()` performs OAuth refresh inside it: that is what stops two
 * concurrent requests both spending the refresh token, which OpenAI
 * invalidates on rotation. One mutex per store instance gives that, and since
 * a Codex registry is cached per profile (see `modelsFor`), the mutex is
 * shared by every request for that profile.
 */
class ProfileCredentialStore implements CredentialStore {
  private mutex = new Mutex();

  constructor(
    private providerId: string,
    private profile: LlmProfileConfig
  ) {}

  async read(): Promise<Credential | undefined> {
    return this.current();
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const credential = this.current();
    return credential ? [{ providerId: this.providerId, type: credential.type }] : [];
  }

  async modify(
    _providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>
  ): Promise<Credential | undefined> {
    return this.mutex.runExclusive(async () => {
      const current = this.current();
      const next = await fn(current);
      if (next === undefined) return current;
      if (next.type !== 'oauth') {
        throw new Error(`Unexpected credential type for profile ${this.profile.id}: ${next.type}`);
      }
      const credentials = toCodexCredentials(next);
      getLlmProfileWriter().updateOAuthCredentials(this.profile.id, credentials);
      // Keep the in-memory profile in step so a second resolve in the same
      // request sees the rotated token rather than re-reading the old one.
      this.profile = { ...this.profile, oauthCredentials: credentials };
      return next;
    });
  }

  async delete(): Promise<void> {
    await this.mutex.runExclusive(async () => {
      getLlmProfileWriter().updateOAuthCredentials(this.profile.id, null);
      this.profile = { ...this.profile, oauthCredentials: undefined };
    });
  }

  private current(): Credential | undefined {
    const creds = this.profile.oauthCredentials;
    return creds ? toOAuthCredential(creds) : undefined;
  }
}

/** Static api-key auth reading the key off the profile. */
function apiKeyAuth(profile: LlmProfileConfig | undefined): ProviderAuth {
  return {
    apiKey: {
      name: profile?.name ?? 'LLM profile',
      async resolve(): Promise<AuthResult | undefined> {
        if (!profile?.apiKey) return undefined;
        return { auth: { apiKey: profile.apiKey }, source: `profile:${profile.name}` };
      },
    },
  };
}

interface RegistryEntry {
  models: Models;
  /** Profile revision the registry was built from. */
  updatedAt: number;
}

const registries = new Map<string, RegistryEntry>();

export function _resetModelsRegistryForTest(): void {
  registries.clear();
}

/** True when this profile authenticates with OAuth rather than an api key. */
export function isOAuthProfile(profile: LlmProfileConfig | undefined): boolean {
  return profile?.providerType === 'openai-codex';
}

/**
 * The provider id a model built for this profile must carry. Callers stamp it
 * onto `model.provider` so the registry can resolve auth for it.
 *
 * Only the OAuth case overrides the model's own provider string — see the
 * module comment for why the api-key case must not.
 */
export function providerIdFor(profile: LlmProfileConfig | undefined, fallback: string): string {
  return isOAuthProfile(profile) && profile ? profile.id : fallback;
}

/**
 * A `Models` registry that can serve requests for `model`.
 *
 * Cached per profile so a Codex profile's requests share one credential store,
 * and therefore one refresh lock. The cache is invalidated when the profile row
 * changes, so an edited key or a re-login takes effect on the next call.
 */
export function modelsFor(model: Model<Api>, profile: LlmProfileConfig | undefined): Models {
  const key = `${profile?.id ?? 'env'}:${model.provider}:${model.api}`;
  const cached = registries.get(key);
  if (cached && cached.updatedAt === (profile?.updatedAt ?? 0)) return cached.models;

  const oauth = isOAuthProfile(profile) && profile;
  const models = createModels(
    oauth ? { credentials: new ProfileCredentialStore(model.provider, profile) } : {}
  );
  models.setProvider(
    createProvider({
      id: model.provider,
      name: profile?.name ?? model.provider,
      auth: oauth ? { oauth: codexOAuth() } : apiKeyAuth(profile),
      models: [model],
      api: streamsFor(model.api),
    })
  );

  registries.set(key, { models, updatedAt: profile?.updatedAt ?? 0 });
  return models;
}
