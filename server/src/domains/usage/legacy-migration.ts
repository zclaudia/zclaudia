import type { Database } from 'better-sqlite3';
import type { RuntimeUsageRepository } from './repository.js';

const BATCH_SIZE = 500;
const WATERMARK_KEY = 'usage_legacy_backfill_watermark';
const BACKFILL_DONE_KEY = 'usage_legacy_backfill_done';

export interface LegacyBackfillResult {
  migrated: number;
  complete: boolean;
}

/**
 * Historical migration (design §7): each historical assistant usage becomes
 * a deterministic `legacy:<messageId>` ledger record. No global CLI logs are
 * scanned and already-lost tokens are not fabricated. Idempotent via the
 * rowid watermark plus the unique legacy_message_id index; rerunning is a
 * no-op.
 *
 * Models come from `metadata.model` — a configuration value, kept only as
 * provenance-marked legacy data (`source_kind = 'legacy_message'`,
 * `usage_status = 'legacy'`, runtime = `legacy`), never presented as a
 * runtime-reported actual model.
 */
export function backfillLegacyUsageRecords(
  db: Database,
  repository: RuntimeUsageRepository,
  options: { now?: number; log?: boolean } = {}
): LegacyBackfillResult {
  const now = options.now ?? Date.now();
  if (repository.getMeta(BACKFILL_DONE_KEY) === '1') {
    return { migrated: 0, complete: true };
  }

  let watermark = Number(repository.getMeta(WATERMARK_KEY) ?? '0');
  if (!Number.isSafeInteger(watermark) || watermark < 0) watermark = 0;
  let migrated = 0;

  const selectBatch = db.prepare(
    `SELECT rowid, id, session_id, created_at, metadata,
            CAST(json_extract(metadata, '$.usage.totalTokens') AS INTEGER) AS totalTokens,
            CAST(json_extract(metadata, '$.usage.output') AS INTEGER) AS outputTokens,
            json_extract(metadata, '$.model') AS model
     FROM messages
     WHERE rowid > ? AND role = 'assistant' AND metadata IS NOT NULL
       AND json_extract(metadata, '$.usage.totalTokens') IS NOT NULL
       AND json_extract(metadata, '$.usageRef.invocationId') IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM runtime_usage_records r WHERE r.assistant_message_id = messages.id
       )
     ORDER BY rowid LIMIT ?`
  );
  const insert = db.transaction((rows: LegacyRow[]) => {
    for (const row of rows) {
      if (repository.hasLegacyRecordForMessage(row.id)) continue;
      if (!Number.isSafeInteger(row.totalTokens) || row.totalTokens < 0) continue;
      repository.insertLegacyRecord({
        messageId: row.id,
        sessionId: row.session_id,
        createdAt: row.created_at,
        totalTokens: row.totalTokens,
        outputTokens: row.outputTokens ?? null,
        model: row.model ?? null,
        now,
      });
      migrated += 1;
    }
    watermark = rows[rows.length - 1].rowid;
    repository.setMeta(WATERMARK_KEY, String(watermark));
  });

  for (;;) {
    const rows = db.prepare('SELECT MAX(rowid) AS maxRowid FROM messages').get() as {
      maxRowid: number | null;
    };
    const batch = selectBatch.all(watermark, BATCH_SIZE) as unknown as LegacyRow[];
    if (batch.length === 0) break;
    insert(batch);
    if (options.log && migrated > 0) {
      console.log(
        `[UsageLedger] legacy backfill migrated ${migrated} messages (watermark ${watermark}/${rows.maxRowid})`
      );
    }
    if (batch.length < BATCH_SIZE) break;
  }

  repository.setMeta(BACKFILL_DONE_KEY, '1');
  return { migrated, complete: true };
}

interface LegacyRow {
  rowid: number;
  id: string;
  session_id: string;
  created_at: number;
  metadata: string;
  totalTokens: number;
  outputTokens: number | null;
  model: string | null;
}

/** True when the ledger is fully active: backfill finished + new calls recorded. */
export function isAccountingActive(repository: RuntimeUsageRepository): boolean {
  return repository.getMeta(BACKFILL_DONE_KEY) === '1';
}
