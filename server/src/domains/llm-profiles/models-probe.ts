import { completeSimple } from '@earendil-works/pi-ai';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import { buildModel } from '../../infra/providers/pi-runtime/build-model.js';

/**
 * Result of {@link probeModel}: round-trip latency on success, a
 * human-readable error string otherwise.
 */
export type ProbeResult = { ok: true; latencyMs: number } | { ok: false; error: string };

const PROBE_TIMEOUT_MS = 15_000;

/**
 * Mid-depth probe of a (profile, modelId) pair. Builds the pi-ai Model
 * literal from the profile (so reserved-header validation, baseUrl
 * derivation, and registry lookup all run) and fires a single
 * `max_tokens: 1` completion with prompt "ping". Returns latency on
 * success, or the upstream / network error message on failure.
 * Times out at 15s.
 *
 * Implementation note: pi-ai's `completeSimple` does NOT throw on upstream
 * / network errors — it resolves to an AssistantMessage with
 * `stopReason: 'error'` (and `errorMessage` set). The probe inspects the
 * stopReason and translates it back into the failure branch so callers see
 * a uniform `{ok, error}` shape regardless of whether the error was a thrown
 * exception (bad config, abort) or a soft error (HTTP 4xx/5xx, ECONNREFUSED).
 */
export async function probeModel(profile: LlmProfileConfig, modelId: string): Promise<ProbeResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // Pass the per-model entry (if declared) so any contextWindow / maxTokens
    // / displayName overrides flow into the built model. For max_tokens=1
    // ping this is mostly cosmetic but keeps the build path consistent with
    // the runtime call site (PiAgentProviderAdapter).
    const modelEntry = profile.models?.find(m => m.modelId === modelId);
    const built = buildModel(profile, modelId, modelEntry);
    // Resolve api key explicitly: completeSimple's `apiKey` option takes
    // precedence over getEnvApiKey, which matches buildModel's intent.
    const apiKey = built.getApiKey ? await built.getApiKey(built.model.provider) : undefined;
    const result = await completeSimple(
      built.model,
      {
        messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }], timestamp: started }],
      },
      {
        maxTokens: 1,
        signal: controller.signal,
        ...(apiKey ? { apiKey } : {}),
      }
    );
    if (result.stopReason === 'error' || result.stopReason === 'aborted') {
      const msg =
        result.errorMessage ||
        `Provider returned stopReason="${result.stopReason}" without an error message`;
      return { ok: false, error: msg };
    }
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
