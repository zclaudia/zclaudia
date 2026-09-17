import type { Database } from 'better-sqlite3';
import type {
  CodexTokenUsageCounters,
  RuntimeUsageSnapshot,
  UsageTokenBreakdown,
} from '@zclaudia/shared/core/runtime-usage';
import type {
  InvocationSettlement,
  ModelAllocationRecord,
  RuntimeUsageExecutionState,
  RuntimeUsageIdentity,
  RuntimeUsageRecordStatus,
  StoredUsageRecord,
} from './types.js';
import { FINALIZED_EXECUTION_STATES } from './types.js';

/**
 * Persistence for `runtime_usage_records` (design §6): one updatable
 * current-accumulation row per invocation. All writes are short
 * transactions; snapshot application is idempotent on
 * (invocation_id, revision) and never moves `accounted_at`, which is fixed
 * at dispatch time (invocation-start date attribution).
 */
export class RuntimeUsageRepository {
  constructor(private readonly db: Database) {}

  /** True when the database carries the ledger schema (migration 045+). */
  static hasLedgerSchema(db: Database): boolean {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('runtime_usage_records', 'server_meta')"
      )
      .all() as Array<{ name: string }>;
    return tables.length >= 2;
  }

  // === server_meta ===

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM server_meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO server_meta (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, Date.now());
  }

  getDatasetId(): string {
    let id = this.getMeta('usage_dataset_id');
    if (!id) {
      id = cryptoRandomId();
      this.setMeta('usage_dataset_id', id);
    }
    return id;
  }

  /** Epoch ms the ledger was activated; null while it has never been armed. */
  getAccountingSince(): number | null {
    const raw = this.getMeta('usage_accounting_since');
    if (raw) return Number(raw);
    // Arm on first read after migration: the schema exists, so accounting
    // begins now. Legacy backfill stamps its own watermark separately.
    const now = String(Date.now());
    this.setMeta('usage_accounting_since', now);
    return Number(now);
  }

  // === lifecycle ===

  startInvocation(identity: RuntimeUsageIdentity, at = Date.now()): void {
    this.getAccountingSince();
    this.db
      .prepare(
        `INSERT INTO runtime_usage_records (
           invocation_id, run_id, session_id, assistant_message_id, parent_invocation_id,
           runtime_id, runtime_version, transport, engine_mode, adapter_version, requested_model,
           execution_state, started_at, accounted_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dispatching', ?, ?, ?)
         ON CONFLICT(invocation_id) DO NOTHING`
      )
      .run(
        identity.invocationId,
        identity.runId,
        identity.sessionId,
        identity.assistantMessageId ?? null,
        identity.parentInvocationId ?? null,
        identity.runtimeId,
        identity.runtimeVersion ?? null,
        identity.transport ?? null,
        identity.engineMode ?? null,
        identity.adapterVersion ?? null,
        identity.requestedModel ?? null,
        at,
        at,
        Date.now()
      );
  }

  markRunning(invocationId: string, at = Date.now()): boolean {
    const info = this.db
      .prepare(
        `UPDATE runtime_usage_records
         SET execution_state = 'running', started_at = COALESCE(started_at, ?), updated_at = ?
         WHERE invocation_id = ? AND execution_state = 'dispatching'`
      )
      .run(at, Date.now(), invocationId);
    return info.changes > 0;
  }

  /**
   * Apply one cumulative usage snapshot. Ignores revisions older than or
   * equal to the stored one (replays, out-of-order delivery); a legitimately
   * newer correction replaces the stored values even when lower.
   */
  applySnapshot(invocationId: string, snapshot: RuntimeUsageSnapshot): boolean {
    const write = this.db.transaction((): boolean => {
      const row = this.db
        .prepare('SELECT revision FROM runtime_usage_records WHERE invocation_id = ?')
        .get(invocationId) as { revision: number } | undefined;
      if (!row) return false;
      if (snapshot.revision <= row.revision) return false;

      const t = snapshot.tokens;
      this.db
        .prepare(
          `UPDATE runtime_usage_records SET
             usage_status = ?,
             reason = ?,
             revision = ?,
             source_kind = ?,
             rule_version = ?,
             includes_subagents = ?,
             input_uncached = ?,
             cache_read = ?,
             cache_write = ?,
             output_tokens = ?,
             reasoning_output = ?,
             total_tokens = ?,
             model_breakdown_json = ?,
             discrepancy = ?,
             source_checkpoint_json = ?,
             updated_at = ?
           WHERE invocation_id = ?`
        )
        .run(
          snapshot.status === 'complete' && !snapshot.final ? 'partial' : snapshot.status,
          snapshot.reason ?? null,
          snapshot.revision,
          snapshot.source.kind,
          snapshot.source.ruleVersion,
          snapshot.source.includesSubagents,
          t.inputUncached,
          t.cacheRead,
          t.cacheWrite,
          t.output,
          t.reasoningOutput,
          t.total,
          snapshot.models.length > 0
            ? JSON.stringify(snapshot.models.map(summarizeModelAllocation))
            : null,
          snapshot.discrepancy ?? null,
          snapshot.checkpoint ? JSON.stringify(snapshot.checkpoint) : null,
          Date.now(),
          invocationId
        );
      return true;
    });
    return write();
  }

  /**
   * Terminal settlement through the single settlement entrance (design §6.4):
   * usage status comes from the stored evidence and is NOT changed by the
   * execution outcome.
   */
  settle(settlement: InvocationSettlement): boolean {
    const endedAt = settlement.endedAt ?? Date.now();
    const info = this.db
      .prepare(
        `UPDATE runtime_usage_records
         SET execution_state = ?,
             ended_at = COALESCE(ended_at, ?),
             updated_at = ?
         WHERE invocation_id = ?
           AND execution_state IN ('dispatching', 'running')`
      )
      .run(settlement.executionState, endedAt, Date.now(), settlement.invocationId);
    return info.changes > 0;
  }

  /** Record an execution failure that definitely never reached the runtime. */
  markNotStarted(invocationId: string, endedAt = Date.now()): boolean {
    const info = this.db
      .prepare(
        `UPDATE runtime_usage_records
         SET execution_state = 'not_started', ended_at = ?, updated_at = ?
         WHERE invocation_id = ? AND execution_state IN ('dispatching', 'running')`
      )
      .run(endedAt, Date.now(), invocationId);
    return info.changes > 0;
  }

  // === queries ===

  getById(invocationId: string): StoredUsageRecord | null {
    const row = this.db
      .prepare('SELECT * FROM runtime_usage_records WHERE invocation_id = ?')
      .get(invocationId) as Record<string, unknown> | undefined;
    return row ? mapRow(row) : null;
  }

  /**
   * Whether any usage evidence (snapshot) was recorded for the invocation —
   * used by the terminal compat path to avoid double counting terminal
   * `result` usage for runtimes that already stream snapshots.
   */
  hasRecordedUsage(invocationId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT revision, total_tokens, input_uncached, cache_read, cache_write,
                output_tokens, reasoning_output
         FROM runtime_usage_records WHERE invocation_id = ?`
      )
      .get(invocationId) as
      | {
          revision: number;
          total_tokens: number | null;
          input_uncached: number | null;
          cache_read: number | null;
          cache_write: number | null;
          output_tokens: number | null;
          reasoning_output: number | null;
        }
      | undefined;
    // Even a missing snapshot is authoritative evidence that this adapter
    // uses the new protocol; never substitute the old per-request counters.
    return !!row && row.revision > 0;
  }

  /**
   * Latest persisted native checkpoint for a session + runtime — the trusted
   * baseline source for resumed Codex threads (design §5.2). Returns the
   * full cumulative counters so the baseline diff can be computed per
   * category, plus the native thread id for same-thread verification.
   */
  findLatestCheckpoint(
    sessionId: string,
    runtimeId: string
  ): { cumulative: CodexTokenUsageCounters; nativeThreadId?: string } | null {
    const row = this.db
      .prepare(
        `SELECT source_checkpoint_json FROM runtime_usage_records
         WHERE session_id = ? AND runtime_id = ? AND source_checkpoint_json IS NOT NULL
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get(sessionId, runtimeId) as { source_checkpoint_json: string } | undefined;
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.source_checkpoint_json) as {
        cumulative?: CodexTokenUsageCounters | null;
        nativeThreadId?: string;
      };
      const cumulative = parsed.cumulative;
      if (
        !cumulative ||
        !(
          typeof cumulative.totalTokens === 'number' &&
          Number.isSafeInteger(cumulative.totalTokens) &&
          cumulative.totalTokens >= 0
        )
      ) {
        return null;
      }
      return {
        cumulative,
        ...(parsed.nativeThreadId ? { nativeThreadId: parsed.nativeThreadId } : {}),
      };
    } catch {
      return null;
    }
  }

  /**
   * Restart recovery (design §6.6): settle every non-terminal record left
   * behind by a dead process. Known token values are kept and downgraded to
   * partial; dispatching (start unconfirmed) records count as missing.
   * Never re-requests the model.
   */
  recoverInterrupted(at = Date.now()): number {
    const info = this.db
      .prepare(
        `UPDATE runtime_usage_records
         SET execution_state = 'interrupted',
             ended_at = COALESCE(ended_at, ?),
             usage_status = CASE
               WHEN total_tokens IS NOT NULL
                 OR input_uncached IS NOT NULL
                 OR cache_read IS NOT NULL
                 OR cache_write IS NOT NULL
                 OR output_tokens IS NOT NULL
                 OR reasoning_output IS NOT NULL THEN 'partial'
               ELSE 'missing'
             END,
             reason = CASE
               WHEN execution_state = 'dispatching'
                 THEN COALESCE(reason || '+', '') || 'interrupted_unconfirmed_start'
               ELSE COALESCE(reason || '+', '') || 'interrupted'
             END,
             updated_at = ?
         WHERE execution_state IN ('dispatching', 'running')`
      )
      .run(at, at);
    return info.changes;
  }

  inFlightCount(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM runtime_usage_records
         WHERE execution_state IN ('dispatching', 'running')`
      )
      .get() as { n: number };
    return row.n;
  }

  // === legacy backfill support ===

  hasLegacyRecordForMessage(messageId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM runtime_usage_records WHERE legacy_message_id = ? LIMIT 1')
      .get(messageId);
    return row !== undefined;
  }

  insertLegacyRecord(input: {
    messageId: string;
    sessionId: string;
    createdAt: number;
    totalTokens: number;
    outputTokens: number | null;
    model: string | null;
    now: number;
  }): boolean {
    try {
      this.db
        .prepare(
          `INSERT INTO runtime_usage_records (
             invocation_id, run_id, session_id, runtime_id,
             execution_state, started_at, ended_at, accounted_at, updated_at,
             usage_status, source_kind, total_tokens, model_breakdown_json,
             legacy_message_id, accounting_version
           ) VALUES (?, ?, ?, 'legacy', 'completed', ?, ?, ?, ?, 'legacy', 'legacy_message', ?, ?, ?, 1)
           ON CONFLICT(invocation_id) DO NOTHING`
        )
        .run(
          `legacy:${input.messageId}`,
          `legacy:${input.sessionId}`,
          input.sessionId,
          input.createdAt,
          input.createdAt,
          input.createdAt,
          input.now,
          input.totalTokens,
          input.model
            ? JSON.stringify([
                {
                  modelId: input.model,
                  total: input.totalTokens,
                  output: input.outputTokens,
                  input:
                    input.outputTokens === null
                      ? input.totalTokens
                      : Math.max(0, input.totalTokens - input.outputTokens),
                },
              ])
            : null,
          input.messageId
        );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // UNIQUE violation on legacy_message_id = already backfilled — skip.
      if (message.includes('UNIQUE')) return false;
      throw error;
    }
  }

  // === aggregation ===

  selectWindowRows(startUtcMs: number, endUtcMs: number): StoredUsageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM runtime_usage_records
                WHERE accounted_at >= ? AND accounted_at < ?`
      )
      .all(startUtcMs, endUtcMs) as Array<Record<string, unknown>>;
    return rows.map(mapRow);
  }

  /** Sum of known totals over FINALIZED rows (the default history total). */
  sumFinalizedTotalTokens(startUtcMs: number, endUtcMs: number): number | null {
    const row = this.db
      .prepare(
        `SELECT SUM(total_tokens) AS n FROM runtime_usage_records
       WHERE total_tokens IS NOT NULL
         AND execution_state NOT IN ('dispatching', 'running', 'not_started')
         AND accounted_at >= ? AND accounted_at < ?`
      )
      .get(startUtcMs, endUtcMs) as { n: number | null };
    return row?.n ?? null;
  }

  executionStateOf(invocationId: string): RuntimeUsageExecutionState | null {
    const row = this.db
      .prepare('SELECT execution_state FROM runtime_usage_records WHERE invocation_id = ?')
      .get(invocationId) as { execution_state: RuntimeUsageExecutionState } | undefined;
    return row?.execution_state ?? null;
  }

  finalizedStates(): readonly RuntimeUsageExecutionState[] {
    return FINALIZED_EXECUTION_STATES;
  }
}

function summarizeModelAllocation(allocation: {
  modelId: string | null;
  tokens: UsageTokenBreakdown;
}): ModelAllocationRecord {
  const input =
    allocation.tokens.inputUncached === null &&
    allocation.tokens.cacheRead === null &&
    allocation.tokens.cacheWrite === null
      ? null
      : (allocation.tokens.inputUncached ?? 0) +
        (allocation.tokens.cacheRead ?? 0) +
        (allocation.tokens.cacheWrite ?? 0);
  return {
    modelId: allocation.modelId,
    total: allocation.tokens.total ?? 0,
    output: allocation.tokens.output,
    input,
  };
}

type RecordStatus = RuntimeUsageRecordStatus;

function mapRow(row: Record<string, unknown>): StoredUsageRecord {
  const tokens = {
    inputUncached: (row.input_uncached as number | null) ?? null,
    cacheRead: (row.cache_read as number | null) ?? null,
    cacheWrite: (row.cache_write as number | null) ?? null,
    output: (row.output_tokens as number | null) ?? null,
    reasoningOutput: (row.reasoning_output as number | null) ?? null,
    total: (row.total_tokens as number | null) ?? null,
  };
  let modelBreakdown: ModelAllocationRecord[] | null = null;
  if (typeof row.model_breakdown_json === 'string') {
    try {
      const parsed = JSON.parse(row.model_breakdown_json) as ModelAllocationRecord[];
      if (Array.isArray(parsed)) modelBreakdown = parsed;
    } catch {
      modelBreakdown = null;
    }
  }
  let checkpoint: StoredUsageRecord['checkpoint'] = null;
  if (typeof row.source_checkpoint_json === 'string') {
    try {
      checkpoint = JSON.parse(row.source_checkpoint_json);
    } catch {
      checkpoint = null;
    }
  }
  return {
    invocationId: row.invocation_id as string,
    runId: row.run_id as string,
    sessionId: row.session_id as string,
    assistantMessageId: (row.assistant_message_id as string | null) ?? null,
    runtimeId: row.runtime_id as string,
    executionState: row.execution_state as RuntimeUsageExecutionState,
    startedAt: (row.started_at as number | null) ?? null,
    endedAt: (row.ended_at as number | null) ?? null,
    accountedAt: (row.accounted_at as number | null) ?? null,
    updatedAt: row.updated_at as number,
    usageStatus: row.usage_status as RecordStatus,
    reason: (row.reason as string | null) ?? null,
    revision: (row.revision as number) ?? 0,
    sourceKind: (row.source_kind as string | null) ?? null,
    ruleVersion: (row.rule_version as number | null) ?? null,
    includesSubagents: (row.includes_subagents as string | null) ?? null,
    tokens,
    contextUsedTokens: (row.context_used_tokens as number | null) ?? null,
    modelBreakdown,
    discrepancy: (row.discrepancy as string | null) ?? null,
    checkpoint,
    legacyMessageId: (row.legacy_message_id as string | null) ?? null,
    accountingVersion: (row.accounting_version as number) ?? 1,
  };
}
function cryptoRandomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
