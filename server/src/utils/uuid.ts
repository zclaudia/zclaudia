import { v7 as uuidv7 } from 'uuid';

/**
 * Generate a new UUIDv7. Time-ordered: lexicographic sort ≈ insertion order,
 * which improves SQLite index locality for PK columns and provides natural
 * chronological hints in logs / debugging.
 *
 * Use this for ALL new IDs across the server. Do NOT call `randomUUID()`
 * directly — those calls were migrated and should not reappear.
 */
export function newId(): string {
  return uuidv7();
}
