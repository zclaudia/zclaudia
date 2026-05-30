import type Database from 'better-sqlite3';

interface ProviderRow {
  id: string;
}

/**
 * Validate the `analysisProviderId` referenced by AI Review / delegation config.
 *
 * Current behavior: accept any existing provider; reject only when the ID
 * doesn't match a row. AI Review capability filtering is deferred until the
 * pi-agent runtime exposes per-provider AI review support.
 */
export function validateAIReviewProviderId(
  db: Database.Database,
  providerId: string | undefined,
): string | null {
  if (!providerId) return null;

  const row = db.prepare('SELECT id FROM providers WHERE id = ?').get(providerId) as ProviderRow | undefined;
  if (!row) {
    return 'Selected AI review provider was not found.';
  }
  return null;
}
