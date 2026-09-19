// Pure derivation helpers for the LLM profile editor: provider-type option
// metadata, dialect labels, reserved header keys, and model-draft serialization.
// No React, no state.
import type { LlmModelDialect, LlmProfileModelEntry } from '@zclaudia/shared';
import { LLM_PROVIDER_TYPES } from '@zclaudia/shared';
import { draftsToEntries, type ModelRowDraft } from '../llmProfileModelDraft';

/** Request-header keys managed by the API-key layer; the freeform header map rejects them. */
export const RESERVED_HEADER_KEYS = new Set(['authorization', 'content-type', 'host']);

/** Human-readable labels for the per-model dialect override select. */
export const DIALECT_LABELS: Record<LlmModelDialect, string> = {
  moonshotai: 'Moonshot (Kimi)',
  deepseek: 'DeepSeek',
  zai: 'GLM (Z.ai)',
  together: 'Together',
  openrouter: 'OpenRouter',
  xai: 'Grok (xAI)',
  openai: 'OpenAI (standard)',
};

export const PROVIDER_TYPE_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI Codex (ChatGPT Plus/Pro)',
};

export const PROVIDER_TYPE_OPTIONS: { value: string; label: string }[] = LLM_PROVIDER_TYPES.map(
  value => ({
    value,
    label: PROVIDER_TYPE_LABELS[value] ?? value,
  })
);

/**
 * Serialize the model drafts into wire entries, stripping fields that don't
 * apply to the current provider type. Anthropic profiles have no dialect
 * select in the UI, so a dialect chosen under a previous provider type must
 * not silently keep forcing openai-compat request shaping — drop it at the
 * serialize boundary (draftsToEntries itself stays provider-agnostic).
 */
export function serializeModelEntries(
  drafts: ModelRowDraft[],
  providerType: string
): LlmProfileModelEntry[] {
  const entries = draftsToEntries(drafts);
  if (providerType !== 'anthropic') return entries;
  return entries.map(({ dialect: _dialect, ...rest }) => rest);
}
