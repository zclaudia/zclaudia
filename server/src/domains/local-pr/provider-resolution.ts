// Resolves which LLM profile a local-PR review/conflict run should use. Extracted from
// LocalPRService so the fallback order is a pure, independently testable rule (QA-0034).
import type { LlmProfileRepository } from '../llm-profiles/repository.js';

/**
 * Picks the first usable LLM profile id from the preferred ids (in order, de-duplicated),
 * falling back to the configured default profile and finally to the first profile that
 * exists. Returns null when no profile is available at all.
 */
export function resolveAvailableProviderId(
  llmProfileRepo: Pick<LlmProfileRepository, 'findById' | 'findDefault' | 'findAll'>,
  preferredIds: Array<string | undefined>
): string | null {
  const checked = new Set<string>();
  for (const id of preferredIds) {
    if (!id || checked.has(id)) continue;
    checked.add(id);
    if (llmProfileRepo.findById(id)) return id;
  }

  const defaultProvider = llmProfileRepo.findDefault();
  if (defaultProvider?.id) return defaultProvider.id;

  const providers = llmProfileRepo.findAll();
  return providers[0]?.id ?? null;
}
