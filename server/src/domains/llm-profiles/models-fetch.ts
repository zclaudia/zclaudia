import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';

/**
 * Result of {@link fetchModelsForProfile}. Sorted, deduplicated list of model
 * ids the upstream provider's `/models` endpoint advertised on success; a
 * human-readable error string on failure (network, non-2xx, or unexpected
 * payload shape).
 */
export type FetchModelsResult =
  | { ok: true; models: string[] }
  | { ok: false; error: string };

interface ProviderFetchSpec {
  url: string;
  headers: Record<string, string>;
}

const FETCH_TIMEOUT_MS = 10_000;

/**
 * Translate a profile into the concrete `/models` URL + auth headers per
 * providerType. baseUrl is optional for both providers — when absent the
 * function falls back to the canonical upstream endpoint.
 *
 * As of migration 004 the legacy `openai-custom` provider type has been
 * folded into `openai`; callers that previously distinguished "vanilla
 * OpenAI" from "OpenAI-compatible proxy" now use the same providerType and
 * just set baseUrl when targeting a custom endpoint.
 */
function resolveSpec(profile: LlmProfileConfig): ProviderFetchSpec | { error: string } {
  const apiKey = profile.apiKey ?? '';
  if (profile.providerType === 'anthropic') {
    const base = profile.baseUrl ?? 'https://api.anthropic.com';
    return {
      url: `${base.replace(/\/$/, '')}/v1/models`,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        ...(profile.requestHeaders ?? {}),
      },
    };
  }
  if (profile.providerType === 'openai') {
    const base = profile.baseUrl ?? 'https://api.openai.com/v1';
    return {
      url: `${base.replace(/\/$/, '')}/models`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(profile.requestHeaders ?? {}),
      },
    };
  }
  return { error: `Provider type "${profile.providerType}" does not expose a /models discovery endpoint` };
}

/**
 * Discover the model ids advertised by an LLM profile's upstream endpoint.
 * Hits `GET <baseUrl>/models` (provider-appropriate path) with the
 * profile's apiKey + requestHeaders, parses an OpenAI-shaped `{data: [{id}]}`
 * payload, dedupes + sorts the ids. Timeouts at 10s.
 */
export async function fetchModelsForProfile(profile: LlmProfileConfig): Promise<FetchModelsResult> {
  const spec = resolveSpec(profile);
  if ('error' in spec) return { ok: false, error: spec.error };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(spec.url, { method: 'GET', headers: spec.headers, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        error: `Upstream returned ${res.status} ${res.statusText}${body ? ': ' + body.slice(0, 200) : ''}`,
      };
    }
    const payload = await res.json().catch(() => null) as { data?: Array<{ id?: unknown }> } | null;
    if (!payload || !Array.isArray(payload.data)) {
      return { ok: false, error: 'Unexpected response shape: missing data[]' };
    }
    const ids = Array.from(new Set(
      payload.data
        .map((row) => row?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    )).sort();
    return { ok: true, models: ids };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
