import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { RuntimeUsageSnapshot } from '@zclaudia/shared/core/runtime-usage';
import { migration as usageLedgerMigration } from '../../../infra/storage/migrations/045_runtime_usage_records.js';
import { UsageRecorder } from '../recorder.js';
import { RuntimeUsageRepository } from '../repository.js';
import { backfillLegacyUsageRecords } from '../legacy-migration.js';
import { UsageQueryService } from '../usage-query.js';
import { resolveUsageWindow, zonedDateKey } from '../time-window.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      offset INTEGER
    );
  `);
  // Targeted schema: only the ledger migration, not the full history —
  // earlier migrations assume columns (archived_at etc.) this fixture omits.
  db.exec(usageLedgerMigration.sql);
  return db;
}

function snapshot(overrides: Partial<RuntimeUsageSnapshot> = {}): RuntimeUsageSnapshot {
  return {
    schemaVersion: 1,
    revision: 1,
    final: false,
    status: 'partial',
    tokens: {
      inputUncached: 100,
      cacheRead: 50,
      cacheWrite: 10,
      output: 20,
      reasoningOutput: 5,
      total: 180,
    },
    models: [],
    source: {
      kind: 'test_source',
      scope: 'invocation',
      includesSubagents: 'unknown',
      ruleVersion: 1,
    },
    ...overrides,
  };
}

function startRun(db: Database.Database, recorder: UsageRecorder, invocationId = 'inv-1'): string {
  db.prepare(
    "INSERT INTO sessions (id, project_id, created_at, updated_at) VALUES (?, 'p', 1, 1)"
  ).run(`sess-${invocationId}`);
  return recorder.beginInvocation({
    invocationId,
    runId: `run-${invocationId}`,
    sessionId: `sess-${invocationId}`,
    runtimeId: 'codex',
    engineMode: 'cli',
  });
}

describe('usage ledger', () => {
  let db: Database.Database;
  let recorder: UsageRecorder;
  let repo: RuntimeUsageRepository;

  beforeEach(() => {
    db = createDb();
    recorder = new UsageRecorder(db);
    repo = recorder.repository;
  });

  it('applies snapshots idempotently: older/equal revisions are ignored, newer replace', () => {
    startRun(db, recorder);
    expect(recorder.applySnapshotEvent('inv-1', snapshot({ revision: 2 }))).toBe(true);
    // Same revision replay (listener redelivery) → no change.
    expect(recorder.applySnapshotEvent('inv-1', snapshot({ revision: 2 }))).toBe(false);
    // Older revision arriving out of order → ignored.
    expect(recorder.applySnapshotEvent('inv-1', snapshot({ revision: 1 }))).toBe(false);
    const record = repo.getById('inv-1')!;
    expect(record.revision).toBe(2);
    expect(record.tokens.total).toBe(180);
  });

  it('rejects negative counters instead of silently normalizing complete usage', () => {
    startRun(db, recorder);
    const invalid = snapshot({ status: 'complete', final: true });
    invalid.tokens.total = -1;
    expect(recorder.applySnapshotEvent('inv-1', invalid)).toBe(false);
    expect(repo.getById('inv-1')!.revision).toBe(0);
  });

  it('rejects invalid snapshots instead of persisting unknown shapes', () => {
    startRun(db, recorder);
    expect(recorder.applySnapshotEvent('inv-1', { schemaVersion: 2 })).toBe(false);
    expect(recorder.applySnapshotEvent('inv-1', { nope: true })).toBe(false);
    expect(recorder.applySnapshotEvent('inv-unknown', snapshot())).toBe(false);
  });

  it('settlement is single-shot and evidence-based; compat usage is low-confidence', () => {
    startRun(db, recorder);
    recorder.settleInvocation({
      invocationId: 'inv-1',
      executionState: 'completed',
      compatUsage: {
        input: 100,
        output: 20,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 120,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    let record = repo.getById('inv-1')!;
    expect(record.executionState).toBe('completed');
    expect(record.usageStatus).toBe('partial'); // never auto-complete
    expect(record.sourceKind).toBe('legacy_terminal_usage');
    expect(record.tokens.total).toBe(120);

    // Second settlement attempt (late duplicate result) is a no-op.
    recorder.settleInvocation({
      invocationId: 'inv-1',
      executionState: 'completed',
      compatUsage: {
        input: 999,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 999,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    record = repo.getById('inv-1')!;
    expect(record.tokens.total).toBe(120);
  });

  it('a streamed snapshot suppresses the terminal compat usage (no double counting)', () => {
    startRun(db, recorder);
    recorder.applySnapshotEvent(
      'inv-1',
      snapshot({ revision: 3, final: true, status: 'complete' })
    );
    recorder.settleInvocation({
      invocationId: 'inv-1',
      executionState: 'completed',
      compatUsage: {
        input: 500,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 500,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    const record = repo.getById('inv-1')!;
    expect(record.tokens.total).toBe(180);
    expect(record.usageStatus).toBe('complete');
  });

  it('a missing snapshot suppresses incompatible legacy terminal totals', () => {
    startRun(db, recorder);
    recorder.applySnapshotEvent(
      'inv-1',
      snapshot({
        status: 'missing',
        final: true,
        tokens: {
          inputUncached: null,
          cacheRead: null,
          cacheWrite: null,
          output: null,
          reasoningOutput: null,
          total: null,
        },
      })
    );
    recorder.settleInvocation({
      invocationId: 'inv-1',
      executionState: 'completed',
      compatUsage: {
        input: 900,
        output: 100,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 1000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    expect(repo.getById('inv-1')!.usageStatus).toBe('missing');
    expect(repo.getById('inv-1')!.tokens.total).toBeNull();
  });

  it('does not mark an interrupted non-final snapshot complete', () => {
    startRun(db, recorder);
    recorder.applySnapshotEvent('inv-1', snapshot({ status: 'complete', final: false }));
    recorder.settleInvocation({ invocationId: 'inv-1', executionState: 'cancelled' });
    expect(repo.getById('inv-1')!.usageStatus).toBe('partial');
  });

  it('a newer revision arriving AFTER settlement replaces the values (late terminal correction)', () => {
    startRun(db, recorder);
    recorder.settleInvocation({ invocationId: 'inv-1', executionState: 'failed' });
    expect(
      recorder.applyLateCorrection(
        'inv-1',
        snapshot({ revision: 5, final: true, status: 'partial', reason: 'late_fix' })
      )
    ).toBe(true);
    const record = repo.getById('inv-1')!;
    expect(record.executionState).toBe('failed'); // execution outcome untouched
    expect(record.revision).toBe(5);
    expect(record.usageStatus).toBe('partial');
  });

  it('restart recovery keeps known values as partial and unconfirmed dispatches as missing', () => {
    startRun(db, recorder, 'inv-a');
    recorder.applySnapshotEvent('inv-a', snapshot({ revision: 1 }));
    startRun(db, recorder, 'inv-b');

    expect(repo.recoverInterrupted()).toBe(2);
    const a = repo.getById('inv-a')!;
    const b = repo.getById('inv-b')!;
    expect(a.executionState).toBe('interrupted');
    expect(a.usageStatus).toBe('partial');
    expect(a.tokens.total).toBe(180);
    expect(b.executionState).toBe('interrupted');
    expect(b.usageStatus).toBe('missing');
    expect(b.reason).toContain('interrupted_unconfirmed_start');
    // Idempotent: no non-terminal records left.
    expect(repo.recoverInterrupted()).toBe(0);
  });

  it('checkpoints survive for resumed-thread baselines and match native thread ids', () => {
    startRun(db, recorder);
    recorder.applySnapshotEvent(
      'inv-1',
      snapshot({
        revision: 2,
        final: true,
        status: 'complete',
        checkpoint: {
          schemaVersion: 1,
          nativeThreadId: 'thread-9',
          cumulative: {
            totalTokens: 100_000,
            inputTokens: 90_000,
            cachedInputTokens: 40_000,
            cacheWriteInputTokens: 0,
            outputTokens: 10_000,
            reasoningOutputTokens: 0,
          },
          capturedAt: Date.now(),
        },
      })
    );
    const checkpoint = repo.findLatestCheckpoint(`sess-inv-1`, 'codex');
    expect(checkpoint?.cumulative.totalTokens).toBe(100_000);
    expect(checkpoint?.nativeThreadId).toBe('thread-9');
    expect(repo.findLatestCheckpoint('sess-inv-1', 'claude')).toBeNull();
  });

  it('the dataset id is stable across reads', () => {
    const first = repo.getDatasetId();
    expect(repo.getDatasetId()).toBe(first);
  });
});

describe('legacy backfill', () => {
  let db: Database.Database;
  let repo: RuntimeUsageRepository;

  beforeEach(() => {
    db = createDb();
    repo = new RuntimeUsageRepository(db);
  });

  function seedAssistant(id: string, totalTokens: number, model?: string, sessionId = 's1') {
    db.prepare(
      "INSERT OR IGNORE INTO sessions (id, project_id, created_at, updated_at) VALUES (?, 'p', 1, 1)"
    ).run(sessionId);
    db.prepare(
      'INSERT INTO messages (id, session_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      id,
      sessionId,
      'assistant',
      'x',
      JSON.stringify({ usage: { totalTokens }, ...(model ? { model } : {}) }),
      Date.now()
    );
  }

  it('does not backfill messages already owned by a new invocation', () => {
    seedAssistant('referenced', 100);
    db.prepare('UPDATE messages SET metadata = ? WHERE id = ?').run(
      JSON.stringify({ usage: { totalTokens: 100 }, usageRef: { invocationId: 'new' } }),
      'referenced'
    );
    seedAssistant('linked', 200);
    repo.startInvocation({
      invocationId: 'new',
      runId: 'run',
      sessionId: 's1',
      runtimeId: 'codex',
      assistantMessageId: 'linked',
    });
    expect(backfillLegacyUsageRecords(db, repo).migrated).toBe(0);
    expect(repo.getById('legacy:referenced')).toBeNull();
    expect(repo.getById('legacy:linked')).toBeNull();
  });

  it('migrates historical usage to deterministic legacy records and is idempotent', () => {
    seedAssistant('m1', 1000, 'claude-sonnet-4-6');
    seedAssistant('m2', 500);
    seedAssistant('m3', 0); // metadata without usage.totalTokens below
    db.prepare(
      "INSERT INTO messages (id, session_id, role, content, metadata, created_at) VALUES ('m4', 's1', 'assistant', 'x', NULL, 1)"
    ).run();

    const first = backfillLegacyUsageRecords(db, repo);
    // m1 + m2 + m3 (a sourced zero IS usage evidence); m4 has no metadata.
    expect(first.migrated).toBe(3);
    expect(first.complete).toBe(true);

    const record = repo.getById('legacy:m1')!;
    expect(record.usageStatus).toBe('legacy');
    expect(record.runtimeId).toBe('legacy');
    expect(record.tokens.total).toBe(1000);
    expect(record.modelBreakdown?.[0]?.modelId).toBe('claude-sonnet-4-6');
    expect(record.legacyMessageId).toBe('m1');

    // Rerun: no duplicates, watermark holds.
    const second = backfillLegacyUsageRecords(db, repo);
    expect(second.migrated).toBe(0);

    // New messages after the completed backfill are picked up again.
    seedAssistant('m5', 700);
    const watermark = repo.getMeta('usage_legacy_backfill_watermark');
    repo.setMeta('usage_legacy_backfill_done', '0');
    const third = backfillLegacyUsageRecords(db, repo);
    expect(third.migrated).toBe(1);
    expect(repo.getById('legacy:m5')).not.toBeNull();
    void watermark;
  });
});

describe('usage query service', () => {
  let db: Database.Database;
  let query: UsageQueryService;

  beforeEach(() => {
    db = createDb();
    query = new UsageQueryService(db);
  });

  function seedRecord(
    invocationId: string,
    overrides: {
      runtimeId?: string;
      status?: 'complete' | 'partial' | 'missing' | 'legacy';
      total?: number | null;
      state?: string;
      accountedAt?: number;
      models?: Array<{
        modelId: string | null;
        total: number;
        output: number | null;
        input: number | null;
      }>;
    }
  ): void {
    const sessionId = `sess-${invocationId}`;
    db.prepare(
      "INSERT INTO sessions (id, project_id, created_at, updated_at) VALUES (?, 'p', 1, 1)"
    ).run(sessionId);
    db.prepare(
      `INSERT INTO runtime_usage_records (
         invocation_id, run_id, session_id, runtime_id, execution_state,
         started_at, ended_at, accounted_at, updated_at,
         usage_status, revision, total_tokens, model_breakdown_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      invocationId,
      `run-${invocationId}`,
      sessionId,
      overrides.runtimeId ?? 'claude',
      overrides.state ?? 'completed',
      overrides.accountedAt ?? Date.now(),
      overrides.accountedAt ?? Date.now(),
      overrides.accountedAt ?? Date.now(),
      Date.now(),
      overrides.status ?? 'complete',
      1,
      overrides.total ?? null,
      overrides.models ? JSON.stringify(overrides.models) : null
    );
  }

  it('excludes unstarted dispatches and live tokens from every historical view', () => {
    seedRecord('done', { total: 100 });
    seedRecord('live', { total: 30, state: 'running', status: 'partial' });
    seedRecord('unstarted', { state: 'not_started', status: 'missing' });
    const payload = query.runtimeUsagePayload('all');
    expect(payload.coverage.eligibleFinalized).toBe(1);
    expect(payload.coverage.rate).toBe(1);
    expect(payload.totals.recordedTokens).toBe(100);
    expect(payload.totals.activeRecordedTokens).toBe(30);
    expect(payload.runtimes.reduce((n, r) => n + (r.recordedTokens ?? 0), 0)).toBe(100);
    expect(query.accountingSummary('all').eligibleFinalized).toBe(1);
    expect(query.modelUsagePayload('all').models.reduce((n, m) => n + m.totalTokens, 0)).toBe(100);
  });

  it('honors asOf for All as well as windowed queries', () => {
    const asOf = Date.UTC(2026, 8, 16, 12);
    seedRecord('before', { total: 100, accountedAt: asOf - 1 });
    seedRecord('future', { total: 200, accountedAt: asOf + 1 });
    expect(query.runtimeUsagePayload('all', 'UTC', asOf).totals.recordedTokens).toBe(100);
    expect(query.repo.sumFinalizedTotalTokens(0, asOf + 1)).toBe(100);
  });

  it('captures Overview, Models and Runtimes with one ledger scan and matching totals', () => {
    const asOf = Date.now();
    seedRecord('complete', {
      total: 100,
      accountedAt: asOf,
      models: [{ modelId: 'm', total: 80, input: 70, output: 10 }],
    });
    seedRecord('partial', { status: 'partial', total: 25, accountedAt: asOf });
    seedRecord('live', { state: 'running', total: 77, accountedAt: asOf });
    seedRecord('future', { total: 999, accountedAt: asOf + 1 });
    const scan = vi.spyOn(query.repo, 'selectWindowRows');
    const payload = query.usageStatsPayload(
      'all',
      {
        sessions: 0,
        messages: 0,
        activeDaysCount: 0,
        currentStreakDays: 0,
        longestStreakDays: 0,
        peakHour: null,
        activeDays: [],
      },
      'Asia/Shanghai',
      asOf,
      true
    );
    expect(scan).toHaveBeenCalledTimes(1);
    expect(payload.totalTokens).toBe(125);
    expect(payload.details?.runtime.totals.recordedTokens).toBe(125);
    expect(payload.details?.models.models.reduce((n, m) => n + m.totalTokens, 0)).toBe(125);
    expect(payload.details?.runtime.asOf).toBe(asOf);
    expect(payload.details?.runtime.timeZone).toBe('Asia/Shanghai');
    expect(payload.details?.models.datasetId).toBe(payload.datasetId);
  });

  it('does not add model allocations with unknown invocation totals to Models', () => {
    seedRecord('unknown', {
      total: null,
      status: 'partial',
      models: [{ modelId: 'm', total: 100, input: 90, output: 10 }],
    });
    expect(query.runtimeUsagePayload('all').totals.recordedTokens).toBeNull();
    expect(query.modelUsagePayload('all').models).toEqual([]);
  });

  it('coverage merges counts additively and never fabricates 100%', () => {
    seedRecord('r1', { status: 'complete', total: 100 });
    seedRecord('r2', { status: 'partial', total: 50, runtimeId: 'codex' });
    seedRecord('r3', { status: 'missing', total: null, runtimeId: 'codex' });
    seedRecord('r4', { status: 'legacy', total: 400, runtimeId: 'legacy' });

    const payload = query.runtimeUsagePayload('all');
    expect(payload.coverage.eligibleFinalized).toBe(3);
    expect(payload.coverage.complete).toBe(1);
    expect(payload.coverage.rate).toBeCloseTo(1 / 3);
    expect(payload.coverage.legacyRecordCount).toBe(1);
    expect(payload.totals.recordedTokens).toBe(550);
    expect(payload.totals.legacyTokens).toBe(400);

    // Per-runtime rows keep Unknown buckets so the three views reconcile.
    const codex = payload.runtimes.find(r => r.runtimeId === 'codex')!;
    expect(codex.calls).toBe(2);
    expect(codex.coverageRate).toBe(0); // partial + missing → 0% complete
    const legacy = payload.runtimes.find(r => r.runtimeId === 'legacy')!;
    expect(legacy.legacyCalls).toBe(1);
    expect(legacy.calls).toBe(0);
    expect(legacy.coverageRate).toBeNull();
  });

  it('model deficit buckets into Unknown; breakdown exceeding total collapses to Unknown with the full total', () => {
    seedRecord('r1', {
      total: 100,
      models: [{ modelId: 'm-a', total: 60, output: 10, input: 50 }],
    });
    seedRecord('r2', {
      total: 80,
      models: [{ modelId: 'm-b', total: 200, output: 0, input: 200 }],
    });

    const payload = query.runtimeUsagePayload('all');
    const claude = payload.runtimes.find(r => r.runtimeId === 'claude')!;
    // r1 deficit → Unknown bucket; r2 collapse → Unknown bucket with the
    // full recorded total. Both Unknown shares merge additively.
    expect(claude.models).toEqual([
      { modelId: null, tokens: 120 },
      { modelId: 'm-a', tokens: 60 },
    ]);

    const models = query.modelUsagePayload('all').models;
    // r2's breakdown exceeded its total: the model row vanishes entirely and
    // the recorded total (80) lands in Unknown — never 200+80 double count.
    expect(models.find(m => m.model === 'm-b')).toBeUndefined();
    const a = models.find(m => m.model === 'm-a')!;
    expect(a.totalTokens).toBe(60);
    const unknown = models.find(m => m.model === 'Unknown')!;
    expect(unknown.totalTokens).toBe(120); // 40 (r1 deficit) + 80 (r2 collapse)
  });

  it('buckets series and days by the requested IANA timezone', () => {
    // 2026-03-08 05:30 UTC = 2026-03-08 00:30 in America/New_York (EST, pre-spring-forward)
    const beforeDst = Date.UTC(2026, 2, 8, 5, 30);
    seedRecord('r1', { total: 10, accountedAt: beforeDst });
    // 2026-03-08 07:30 UTC = 2026-03-08 03:30 in America/New_York (EDT, after spring-forward)
    const afterDst = Date.UTC(2026, 2, 8, 7, 30);
    seedRecord('r2', { total: 20, accountedAt: afterDst, runtimeId: 'codex' });

    const payload = query.runtimeUsagePayload('all', 'America/New_York');
    expect(payload.timeZone).toBe('America/New_York');
    expect(payload.series.length).toBe(1);
    expect(payload.series[0].date).toBe('2026-03-08');
    expect(payload.series[0].runtimes).toEqual({ claude: 10, codex: 20 });
  });

  it('in-flight invocations are reported separately, not in the coverage denominator', () => {
    seedRecord('r1', { total: 30, state: 'running', status: 'partial' });
    const payload = query.runtimeUsagePayload('all');
    expect(payload.coverage.eligibleFinalized).toBe(0);
    expect(payload.coverage.rate).toBeNull();
    expect(payload.coverage.inFlight).toBe(1);
    expect(payload.totals.recordedTokens).toBeNull();
    expect(payload.totals.activeRecordedTokens).toBe(30);
  });
});

describe('time window', () => {
  it('7d/30d are calendar days including today in the user zone (DST-safe)', () => {
    // Spring-forward day in New York (2026-03-08 is a 23h day).
    const asOf = Date.UTC(2026, 2, 8, 12); // noon UTC = 08:00 EDT
    const window = resolveUsageWindow('7d', 'America/New_York', asOf);
    // Window starts at local midnight of today minus 6 calendar days...
    expect(zonedDateKey('America/New_York', window.startUtcMs)).toBe('2026-03-02');
    // ...and is clamped at the requested asOf within the ongoing today.
    expect(window.endUtcMs).toBe(asOf + 1);
    // Six full days + the partial today span exactly 6 midnights.
    expect(Math.round((asOf + 1 - window.startUtcMs) / 86_400_000)).toBe(6);
  });

  it('an invalid timezone falls back to UTC instead of throwing', () => {
    const window = resolveUsageWindow('7d', 'Not/AZone', Date.now());
    expect(window.timeZone).toBe('UTC');
  });

  it("'all' covers every retained record", () => {
    const asOf = Date.UTC(2026, 8, 16, 12);
    const window = resolveUsageWindow('all', 'Asia/Shanghai', asOf);
    expect(window.startUtcMs).toBe(0);
  });
});
