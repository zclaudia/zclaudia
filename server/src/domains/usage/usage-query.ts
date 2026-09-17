import type { Database } from 'better-sqlite3';
import type {
  AccountingSummary,
  ModelUsagePayload,
  ModelUsageTotal,
  RuntimeUsagePayload,
  RuntimeUsageRuntimeRow,
  RuntimeUsageSeriesPoint,
  UsageStatsPayload,
  UsageStatsRange,
} from '@zclaudia/shared/core/usage-stats';
import type { StoredUsageRecord } from './types.js';
import { IN_FLIGHT_EXECUTION_STATES, LEGACY_RUNTIME_ID } from './types.js';
import { RuntimeUsageRepository } from './repository.js';
import { isAccountingActive } from './legacy-migration.js';
import { resolveUsageWindow, zonedDateKey, type UsageWindow } from './time-window.js';

/** Display label for allocations without a runtime-reported model id. */
export const UNKNOWN_MODEL_LABEL = 'Unknown';

/**
 * Unified statistics source (design §8): Overview, Models and Runtimes all
 * read the same ledger window. Counts merge additively; percentages are
 * recomputed from merged numerators and denominators, never averaged.
 */
export class UsageQueryService {
  private readonly repository: RuntimeUsageRepository;
  /** False on databases without migration 045 (test fixtures, restored backups). */
  private readonly available: boolean;

  constructor(db: Database) {
    this.repository = new RuntimeUsageRepository(db);
    this.available = RuntimeUsageRepository.hasLedgerSchema(db);
  }

  get repo(): RuntimeUsageRepository {
    return this.repository;
  }

  accountingActive(): boolean {
    return this.available && isAccountingActive(this.repository);
  }

  datasetId(): string {
    return this.repository.getDatasetId();
  }

  accountingSince(): number | null {
    return this.repository.getAccountingSince();
  }

  /** GET /api/stats/runtime-usage payload. */
  runtimeUsagePayload(
    range: UsageStatsRange,
    timeZone?: string,
    asOf = Date.now()
  ): RuntimeUsagePayload {
    if (!this.available) {
      return {
        schemaVersion: 1,
        datasetId: 'unavailable',
        asOf,
        timeZone: timeZone && timeZone.trim() ? timeZone.trim() : 'UTC',
        accountingSince: null,
        accountingActive: false,
        capturedAt: Date.now(),
        totals: {
          recordedTokens: null,
          completeTokens: null,
          partialTokens: null,
          legacyTokens: null,
          activeRecordedTokens: null,
        },
        coverage: {
          complete: 0,
          partial: 0,
          missing: 0,
          eligibleFinalized: 0,
          inFlight: 0,
          rate: null,
          legacyRecordCount: 0,
        },
        runtimes: [],
        series: [],
      };
    }
    const window = resolveUsageWindow(range, timeZone, asOf);
    const rows = this.repository.selectWindowRows(window.startUtcMs, window.endUtcMs);

    const finalized = rows.filter(row => isFinalized(row.executionState));
    const inFlight = rows.filter(row => isInFlight(row.executionState));

    const sumKnown = (values: Array<number | null>): number | null => {
      let sum = 0;
      let known = false;
      for (const value of values) {
        if (value !== null) {
          sum += value;
          known = true;
        }
      }
      return known ? sum : null;
    };

    const totals = {
      recordedTokens: sumKnown(finalized.map(row => row.tokens.total)),
      completeTokens: sumKnown(
        finalized.filter(r => r.usageStatus === 'complete').map(r => r.tokens.total)
      ),
      partialTokens: sumKnown(
        finalized.filter(r => r.usageStatus === 'partial').map(r => r.tokens.total)
      ),
      legacyTokens: sumKnown(
        finalized.filter(r => r.usageStatus === 'legacy').map(r => r.tokens.total)
      ),
      activeRecordedTokens: sumKnown(inFlight.map(row => row.tokens.total)),
    };

    const eligible = finalized.filter(row => row.usageStatus !== 'legacy');
    const complete = eligible.filter(row => row.usageStatus === 'complete').length;
    const partial = eligible.filter(row => row.usageStatus === 'partial').length;
    const missing = eligible.filter(row => row.usageStatus === 'missing').length;
    const eligibleFinalized = eligible.length;

    const runtimes = buildRuntimeRows(finalized, inFlight);
    const series = buildSeries(finalized, window);

    return {
      schemaVersion: 1,
      datasetId: this.repository.getDatasetId(),
      asOf,
      timeZone: window.timeZone,
      accountingSince: this.repository.getAccountingSince(),
      accountingActive: this.accountingActive(),
      capturedAt: Date.now(),
      totals,
      coverage: {
        complete,
        partial,
        missing,
        eligibleFinalized,
        inFlight: inFlight.length,
        rate: eligibleFinalized > 0 ? complete / eligibleFinalized : null,
        legacyRecordCount: finalized.length - eligibleFinalized,
      },
      runtimes,
      series,
    };
  }

  /**
   * Accounting summary projected onto GET /api/stats/usage so the Overview
   * strip can show "Recorded tokens" + coverage from the same ledger.
   */
  accountingSummary(
    range: UsageStatsRange,
    timeZone?: string,
    asOf = Date.now()
  ): AccountingSummary {
    if (!this.available) {
      return {
        active: true,
        recordedTokens: null,
        completeCalls: 0,
        partialCalls: 0,
        missingCalls: 0,
        eligibleFinalized: 0,
        inFlightCalls: 0,
        legacyRecords: 0,
        accountingSince: null,
      };
    }
    const window = resolveUsageWindow(range, timeZone, asOf);
    const rows = this.repository.selectWindowRows(window.startUtcMs, window.endUtcMs);
    const finalized = rows.filter(row => isFinalized(row.executionState));
    const inFlight = rows.filter(row => isInFlight(row.executionState));
    const eligible = finalized.filter(row => row.usageStatus !== 'legacy');
    const recordedValues = finalized
      .map(row => row.tokens.total)
      .filter((v): v is number => v !== null);
    return {
      active: true,
      recordedTokens: recordedValues.length > 0 ? recordedValues.reduce((a, b) => a + b, 0) : null,
      completeCalls: eligible.filter(row => row.usageStatus === 'complete').length,
      partialCalls: eligible.filter(row => row.usageStatus === 'partial').length,
      missingCalls: eligible.filter(row => row.usageStatus === 'missing').length,
      eligibleFinalized: eligible.length,
      inFlightCalls: inFlight.length,
      legacyRecords: finalized.length - eligible.length,
      accountingSince: this.repository.getAccountingSince(),
    };
  }

  /**
   * Ledger-powered legacy shape for GET /api/stats/usage. Activity metrics
   * (sessions/messages/heatmap/streaks) stay on the messages SQL passed in by
   * the caller; token + favorite-model semantics switch to the ledger.
   */
  usageStatsPayload(
    range: UsageStatsRange,
    activity: Pick<
      UsageStatsPayload,
      | 'sessions'
      | 'messages'
      | 'activeDaysCount'
      | 'currentStreakDays'
      | 'longestStreakDays'
      | 'peakHour'
      | 'activeDays'
    >,
    timeZone?: string,
    asOf = Date.now()
  ): UsageStatsPayload {
    if (!this.available) {
      return {
        ...activity,
        totalTokens: 0,
        favoriteModel: null,
        allTimeTokens: 0,
        capturedAt: Date.now(),
      };
    }
    const window = resolveUsageWindow(range, timeZone, asOf);
    const finalizedTotal = this.repository.sumFinalizedTotalTokens(
      window.startUtcMs,
      window.endUtcMs
    );
    const allTimeTotal = this.repository.sumFinalizedTotalTokens(0, asOf + 1);
    const favorite = this.favoriteModel(window);
    return {
      ...activity,
      datasetId: this.datasetId(),
      totalTokens: finalizedTotal ?? 0,
      favoriteModel: favorite,
      allTimeTokens: allTimeTotal ?? 0,
      capturedAt: Date.now(),
      accounting: this.accountingSummary(range, timeZone, asOf),
    };
  }

  /** Ledger-powered legacy shape for GET /api/stats/models. */
  modelUsagePayload(
    range: UsageStatsRange,
    timeZone?: string,
    asOf = Date.now()
  ): ModelUsagePayload {
    if (!this.available) {
      return { days: [], models: [], trackedSince: null, capturedAt: Date.now() };
    }
    const window = resolveUsageWindow(range, timeZone, asOf);
    const rows = this.repository
      .selectWindowRows(window.startUtcMs, window.endUtcMs)
      .filter(row => isFinalized(row.executionState));

    const dayMap = new Map<string, Map<string, number>>();
    const totals = new Map<string, { total: number; output: number }>();
    for (const row of rows) {
      const date = row.accountedAt !== null ? zonedDateKey(window.timeZone, row.accountedAt) : null;
      const allocations = effectiveAllocations(row);
      for (const allocation of allocations) {
        if (allocation.total <= 0) continue;
        // Unknown-model allocations stay in the payload so Models reconciles
        // with Overview totals (design §9).
        const modelKey = allocation.modelId ?? UNKNOWN_MODEL_LABEL;
        if (date) {
          const day = dayMap.get(date) ?? new Map<string, number>();
          day.set(modelKey, (day.get(modelKey) ?? 0) + allocation.total);
          dayMap.set(date, day);
        }
        const t = totals.get(modelKey) ?? { total: 0, output: 0 };
        t.total += allocation.total;
        t.output += allocation.output ?? 0;
        totals.set(modelKey, t);
      }
    }

    const grandTotal = [...totals.values()].reduce((sum, t) => sum + t.total, 0);
    const days = [...dayMap.entries()]
      .map(([date, models]) => ({
        date,
        models: Object.fromEntries(models) as Record<string, number>,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const models: ModelUsageTotal[] = [...totals.entries()]
      .map(([model, t]) => ({
        model,
        inTokens: Math.max(0, t.total - t.output),
        outTokens: t.output,
        totalTokens: t.total,
        share: grandTotal > 0 ? t.total / grandTotal : 0,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens);

    return {
      datasetId: this.datasetId(),
      days,
      models,
      trackedSince: this.repository.getAccountingSince(),
      capturedAt: Date.now(),
    };
  }

  private favoriteModel(window: UsageWindow): string | null {
    if (!this.available) return null;
    const rows = this.repository
      .selectWindowRows(window.startUtcMs, window.endUtcMs)
      .filter(row => isFinalized(row.executionState));
    const totals = new Map<string, number>();
    for (const row of rows) {
      for (const allocation of effectiveAllocations(row)) {
        if (!allocation.modelId || allocation.total <= 0) continue;
        totals.set(allocation.modelId, (totals.get(allocation.modelId) ?? 0) + allocation.total);
      }
    }
    let best: { model: string; total: number } | null = null;
    for (const [model, total] of totals) {
      if (!best || total > best.total || (total === best.total && model < best.model)) {
        best = { model, total };
      }
    }
    return best?.model ?? null;
  }
}

/**
 * Model allocations for aggregation (design §3.4): allocations are mutually
 * exclusive; a deficit vs the record total buckets into Unknown model; when
 * the breakdown exceeds the total (unclear containment), the whole recorded
 * total goes to Unknown instead of double counting.
 */
export function effectiveAllocations(row: StoredUsageRecord): Array<{
  modelId: string | null;
  total: number;
  output: number | null;
  input: number | null;
}> {
  const breakdown = row.modelBreakdown ?? [];
  const allocated = breakdown.reduce((sum, entry) => sum + entry.total, 0);
  const total = row.tokens.total;
  if (total === null) {
    return [];
  }
  if (allocated > total || row.discrepancy) {
    return [{ modelId: null, total, output: row.tokens.output, input: inputSide(row) }];
  }
  const result = breakdown.map(entry => ({ ...entry }));
  if (allocated < total) {
    result.push({ modelId: null, total: total - allocated, output: null, input: null });
  }
  return result;
}

function inputSide(row: StoredUsageRecord): number | null {
  const { inputUncached, cacheRead, cacheWrite } = row.tokens;
  if (inputUncached === null || cacheRead === null || cacheWrite === null) return null;
  return (inputUncached ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0);
}

function isFinalized(state: StoredUsageRecord['executionState']): boolean {
  return state !== 'not_started' && !isInFlight(state);
}

function isInFlight(state: StoredUsageRecord['executionState']): boolean {
  return (IN_FLIGHT_EXECUTION_STATES as readonly string[]).includes(state);
}

function buildRuntimeRows(
  finalized: StoredUsageRecord[],
  inFlight: StoredUsageRecord[]
): RuntimeUsageRuntimeRow[] {
  interface RuntimeAgg {
    recordedKnown: boolean;
    recorded: number;
    inputKnown: boolean;
    input: number;
    outputKnown: boolean;
    output: number;
    complete: number;
    partial: number;
    missing: number;
    legacy: number;
    eligibleCalls: number;
    inFlight: number;
    models: Map<string, number>;
  }
  const emptyAgg = (): RuntimeAgg => ({
    recordedKnown: false,
    recorded: 0,
    inputKnown: false,
    input: 0,
    outputKnown: false,
    output: 0,
    complete: 0,
    partial: 0,
    missing: 0,
    legacy: 0,
    eligibleCalls: 0,
    inFlight: 0,
    models: new Map(),
  });
  const aggregates = new Map<string, RuntimeAgg>();

  const addRow = (row: StoredUsageRecord, isInFlightRow: boolean) => {
    const key = row.usageStatus === 'legacy' ? LEGACY_RUNTIME_ID : row.runtimeId;
    const agg = aggregates.get(key) ?? emptyAgg();
    if (isInFlightRow) {
      agg.inFlight += 1;
      aggregates.set(key, agg);
      return;
    }
    if (row.tokens.total !== null) {
      agg.recordedKnown = true;
      agg.recorded += row.tokens.total;
    }
    const input = inputSide(row);
    if (input !== null) {
      agg.inputKnown = true;
      agg.input += input;
    }
    if (row.tokens.output !== null) {
      agg.outputKnown = true;
      agg.output += row.tokens.output;
    }
    if (isInFlightRow) {
      agg.inFlight += 1;
    } else if (row.usageStatus === 'legacy') {
      agg.legacy += 1;
    } else {
      agg.eligibleCalls += 1;
      if (row.usageStatus === 'complete') agg.complete += 1;
      else if (row.usageStatus === 'partial') agg.partial += 1;
      else agg.missing += 1;
    }
    for (const allocation of effectiveAllocations(row)) {
      if (allocation.total <= 0) continue;
      const modelKey = allocation.modelId ?? '__unknown__';
      agg.models.set(modelKey, (agg.models.get(modelKey) ?? 0) + allocation.total);
    }
    aggregates.set(key, agg);
  };

  for (const row of finalized) addRow(row, false);
  for (const row of inFlight) addRow(row, true);

  const labelFor = (runtimeId: string): string | null =>
    runtimeId === LEGACY_RUNTIME_ID ? null : runtimeLabel(runtimeId);

  return [...aggregates.entries()]
    .map(([runtimeId, agg]) => ({
      runtimeId,
      runtimeLabel: labelFor(runtimeId),
      recordedTokens: agg.recordedKnown ? agg.recorded : null,
      inputTokens: agg.inputKnown ? agg.input : null,
      outputTokens: agg.outputKnown ? agg.output : null,
      calls: agg.eligibleCalls,
      completeCalls: agg.complete,
      partialCalls: agg.partial,
      missingCalls: agg.missing,
      legacyCalls: agg.legacy,
      inFlightCalls: agg.inFlight,
      coverageRate: agg.eligibleCalls > 0 ? agg.complete / agg.eligibleCalls : null,
      models: [...agg.models.entries()]
        .map(([modelId, tokens]) => ({
          modelId: modelId === '__unknown__' ? null : modelId,
          tokens,
        }))
        .sort((a, b) => b.tokens - a.tokens),
    }))
    .sort((a, b) => (b.recordedTokens ?? 0) - (a.recordedTokens ?? 0));
}

function runtimeLabel(runtimeId: string): string | null {
  switch (runtimeId) {
    case 'claude':
      return 'Claude Code';
    case 'codex':
      return 'Codex';
    case 'cursor':
      return 'Cursor';
    case 'pi':
      return 'Pi';
    default:
      return runtimeId;
  }
}

function buildSeries(
  finalized: StoredUsageRecord[],
  window: UsageWindow
): RuntimeUsageSeriesPoint[] {
  const byDate = new Map<string, Map<string, number>>();
  for (const row of finalized) {
    if (row.accountedAt === null || row.accountedAt < window.startUtcMs) continue;
    if (row.tokens.total === null || row.tokens.total <= 0) continue;
    const date = zonedDateKey(window.timeZone, row.accountedAt);
    const runtimeKey = row.usageStatus === 'legacy' ? LEGACY_RUNTIME_ID : row.runtimeId;
    const day = byDate.get(date) ?? new Map<string, number>();
    day.set(runtimeKey, (day.get(runtimeKey) ?? 0) + row.tokens.total);
    byDate.set(date, day);
  }
  return [...byDate.entries()]
    .map(([date, runtimes]) => ({ date, runtimes: Object.fromEntries(runtimes) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
