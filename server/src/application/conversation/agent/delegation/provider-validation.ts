import type Database from 'better-sqlite3';

interface ProviderRow {
  id: string;
}

/**
 * Validate the `analysisLlmProfileId` referenced by AI Review / delegation config.
 *
 * Current behavior: accept any existing provider; reject only when the ID
 * doesn't match a row. AI Review capability filtering is deferred until the
 * pi-agent runtime exposes per-provider AI review support.
 */
export function validateAIReviewProviderId(
  db: Database.Database,
  llmProfileId: string | undefined
): string | null {
  if (!llmProfileId) return null;

  const row = db.prepare('SELECT id FROM llm_profiles WHERE id = ?').get(llmProfileId) as
    | ProviderRow
    | undefined;
  if (!row) {
    return 'Selected AI review provider was not found.';
  }
  return null;
}
