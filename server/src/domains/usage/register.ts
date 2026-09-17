import type { Database } from 'better-sqlite3';
import { backfillLegacyUsageRecords } from './legacy-migration.js';
import { RuntimeUsageRepository } from './repository.js';
import { UsageQueryService } from './usage-query.js';

/**
 * One-time per-process ledger initialization (design §7): the legacy backfill
 * runs synchronously at startup — idempotent via its watermark + unique
 * legacy_message_id index — and the host event handler persists usage before notifying domain
 * listeners. From activation, every new invocation gets a ledger record
 * even when it carries no usage.
 */
const initialized = new WeakMap<Database, UsageQueryService>();

export function initializeUsageLedger(
  db: Database,
  options: { log?: boolean } = {}
): UsageQueryService {
  const existing = initialized.get(db);
  if (existing) return existing;

  // Schema guard: test fixtures and databases restored without migration 045
  // carry no ledger tables. Accounting stays inactive and the legacy
  // projection keeps serving — a missing table must never 500 the stats API.
  const hasLedgerSchema = RuntimeUsageRepository.hasLedgerSchema(db);

  if (hasLedgerSchema) {
    const repository = new RuntimeUsageRepository(db);
    repository.getAccountingSince();
    try {
      const result = backfillLegacyUsageRecords(db, repository, { log: options.log });
      if (options.log && result.migrated > 0) {
        console.log(`[UsageLedger] active; ${result.migrated} legacy records migrated`);
      }
    } catch (error) {
      // Backfill failure must not take the server down: token statistics keep
      // serving from the message projection until the ledger is switched on.
      console.error(
        '[UsageLedger] legacy backfill failed; stats stay on the legacy projection:',
        error instanceof Error ? error.message : error
      );
    }
  } else if (options.log) {
    console.warn('[UsageLedger] ledger tables absent; token stats stay on the legacy projection');
  }

  const service = new UsageQueryService(db);
  initialized.set(db, service);
  return service;
}
