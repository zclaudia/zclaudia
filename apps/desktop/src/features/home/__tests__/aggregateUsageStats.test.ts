import { describe, it, expect } from 'vitest';
import type { ModelUsagePayload, RuntimeUsagePayload, UsageStatsPayload } from '@zclaudia/shared';
import {
  aggregateUsageStats,
  aggregateModelStats,
  aggregateRuntimeUsage,
} from '../aggregateUsageStats';

function stats(over: Partial<UsageStatsPayload> = {}): UsageStatsPayload {
  return {
    sessions: 0,
    messages: 0,
    totalTokens: 0,
    activeDaysCount: 0,
    currentStreakDays: 0,
    longestStreakDays: 0,
    peakHour: null,
    favoriteModel: null,
    allTimeTokens: 0,
    activeDays: [],
    capturedAt: 1,
    ...over,
  };
}

describe('aggregateUsageStats', () => {
  it('deduplicates the same dataset in Overview and Models', () => {
    const p = stats({ datasetId: 'db', totalTokens: 100 });
    expect(
      aggregateUsageStats(
        [
          { backendId: 'local', name: 'Local', stats: p },
          { backendId: 'gateway', name: 'Gateway', stats: p },
        ],
        '2026-09-17',
        'all'
      )!.totalTokens
    ).toBe(100);
    const m: ModelUsagePayload = {
      datasetId: 'db',
      days: [],
      trackedSince: null,
      capturedAt: 1,
      models: [{ model: 'm', inTokens: 90, outTokens: 10, totalTokens: 100, share: 1 }],
    };
    expect(aggregateModelStats([m, m])!.models[0].totalTokens).toBe(100);
  });

  it('does not claim whole-set coverage or discard old-backend tokens in mixed versions', () => {
    const merged = aggregateUsageStats(
      [
        { backendId: 'old', name: 'Old', stats: stats({ totalTokens: 100 }) },
        {
          backendId: 'new',
          name: 'New',
          stats: stats({
            totalTokens: 20,
            accounting: {
              active: true,
              recordedTokens: 20,
              completeCalls: 1,
              partialCalls: 0,
              missingCalls: 0,
              eligibleFinalized: 1,
              inFlightCalls: 0,
              legacyRecords: 0,
              accountingSince: 1,
            },
          }),
        },
      ],
      '2026-09-17',
      'all'
    )!;
    expect(merged.totalTokens).toBe(120);
    expect(merged.accounting).toBeUndefined();
  });

  it('returns the single payload untouched', () => {
    const only = stats({ sessions: 3 });
    expect(
      aggregateUsageStats([{ backendId: 'a', name: 'A', stats: only }], '2026-08-06', 'all')
    ).toBe(only);
  });

  it('sums counters and counts a shared calendar day once', () => {
    const merged = aggregateUsageStats(
      [
        {
          backendId: 'a',
          name: 'A',
          stats: stats({
            sessions: 2,
            messages: 10,
            totalTokens: 100,
            allTimeTokens: 500,
            activeDays: [
              { date: '2026-08-05', count: 3 },
              { date: '2026-08-06', count: 1 },
            ],
          }),
        },
        {
          backendId: 'b',
          name: 'B',
          stats: stats({
            sessions: 1,
            messages: 4,
            totalTokens: 40,
            allTimeTokens: 60,
            // Same day as A: one active day, not two.
            activeDays: [{ date: '2026-08-06', count: 2 }],
          }),
        },
      ],
      '2026-08-06',
      'all'
    );

    expect(merged).not.toBeNull();
    expect(merged!.sessions).toBe(3);
    expect(merged!.messages).toBe(14);
    expect(merged!.totalTokens).toBe(140);
    expect(merged!.allTimeTokens).toBe(560);
    expect(merged!.activeDaysCount).toBe(2);
    expect(merged!.activeDays).toEqual([
      { date: '2026-08-05', count: 3 },
      { date: '2026-08-06', count: 3 },
    ]);
  });

  it('bridges a streak that spans two backends', () => {
    const merged = aggregateUsageStats(
      [
        {
          backendId: 'a',
          name: 'A',
          stats: stats({ activeDays: [{ date: '2026-08-04', count: 1 }] }),
        },
        {
          backendId: 'b',
          name: 'B',
          stats: stats({
            activeDays: [
              { date: '2026-08-05', count: 1 },
              { date: '2026-08-06', count: 1 },
            ],
          }),
        },
      ],
      '2026-08-06',
      'all'
    );
    // Neither backend alone has a 3-day run; together they do.
    expect(merged!.currentStreakDays).toBe(3);
    expect(merged!.longestStreakDays).toBe(3);
  });

  it('scopes day-derived figures to the requested range', () => {
    const merged = aggregateUsageStats(
      [
        {
          backendId: 'a',
          name: 'A',
          stats: stats({
            activeDays: [
              { date: '2026-06-01', count: 1 },
              { date: '2026-08-05', count: 1 },
            ],
          }),
        },
        {
          backendId: 'b',
          name: 'B',
          stats: stats({ activeDays: [{ date: '2026-08-06', count: 1 }] }),
        },
      ],
      '2026-08-06',
      '7d'
    );
    // The June day is outside the 7-day window; the heatmap still carries it.
    expect(merged!.activeDaysCount).toBe(2);
    expect(merged!.longestStreakDays).toBe(2);
    expect(merged!.activeDays).toHaveLength(3);
  });
});

function models(over: Partial<ModelUsagePayload> = {}): ModelUsagePayload {
  return { days: [], models: [], trackedSince: null, capturedAt: 1, ...over };
}

describe('aggregateModelStats', () => {
  it('merges per-model totals and recomputes shares against the merged total', () => {
    const merged = aggregateModelStats([
      models({
        days: [{ date: '2026-08-06', models: { sonnet: 60 } }],
        models: [{ model: 'sonnet', inTokens: 40, outTokens: 20, totalTokens: 60, share: 1 }],
        trackedSince: 200,
      }),
      models({
        days: [{ date: '2026-08-06', models: { sonnet: 20, haiku: 20 } }],
        models: [
          { model: 'sonnet', inTokens: 15, outTokens: 5, totalTokens: 20, share: 0.5 },
          { model: 'haiku', inTokens: 10, outTokens: 10, totalTokens: 20, share: 0.5 },
        ],
        trackedSince: 100,
      }),
    ]);

    expect(merged!.days).toEqual([{ date: '2026-08-06', models: { sonnet: 80, haiku: 20 } }]);
    expect(merged!.models.map(m => [m.model, m.totalTokens, m.share])).toEqual([
      ['sonnet', 80, 0.8],
      ['haiku', 20, 0.2],
    ]);
    // Tracking started as early as the earliest backend recorded it.
    expect(merged!.trackedSince).toBe(100);
  });
});

// === Runtime usage ledger aggregation (runtime usage design §8) ===

function runtimePayload(
  datasetId: string,
  over: Partial<RuntimeUsagePayload> = {}
): RuntimeUsagePayload {
  return {
    schemaVersion: 1,
    datasetId,
    asOf: 1000,
    timeZone: 'UTC',
    accountingSince: 500,
    accountingActive: true,
    capturedAt: 1000,
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
    ...over,
  };
}

describe('aggregateRuntimeUsage', () => {
  it('counts the same datasetId once (local + gateway connection to one database)', () => {
    const same = runtimePayload('ds-1', {
      totals: { ...runtimePayload('').totals, recordedTokens: 500 },
      coverage: {
        complete: 4,
        partial: 1,
        missing: 0,
        eligibleFinalized: 5,
        inFlight: 1,
        rate: 0.8,
        legacyRecordCount: 0,
      },
    });
    const { merged, deduplicated, sourcesTotal } = aggregateRuntimeUsage([
      { backendId: 'local', name: 'Local', payload: same },
      { backendId: 'gw', name: 'Gateway relay', payload: same },
    ]);
    expect(deduplicated).toBe(1);
    expect(sourcesTotal).toBe(2);
    // 500 + 500 would be a double count; the dedupe keeps one copy.
    expect(merged!.totals.recordedTokens).toBe(500);
    expect(merged!.coverage.eligibleFinalized).toBe(5);
  });

  it('merges distinct datasets additively and recomputes coverage from merged counts', () => {
    const a = runtimePayload('ds-1', {
      totals: { ...runtimePayload('').totals, recordedTokens: 100, legacyTokens: 40 },
      coverage: {
        complete: 1,
        partial: 1,
        missing: 0,
        eligibleFinalized: 2,
        inFlight: 0,
        rate: 0.5,
        legacyRecordCount: 3,
      },
      runtimes: [
        {
          runtimeId: 'claude',
          runtimeLabel: 'Claude Code',
          recordedTokens: 100,
          inputTokens: 80,
          outputTokens: 20,
          calls: 2,
          completeCalls: 1,
          partialCalls: 1,
          missingCalls: 0,
          legacyCalls: 0,
          inFlightCalls: 0,
          coverageRate: 0.5,
          models: [{ modelId: 'sonnet', tokens: 100 }],
        },
      ],
      series: [{ date: '2026-09-15', runtimes: { claude: 100 } }],
    });
    const b = runtimePayload('ds-2', {
      coverage: {
        complete: 0,
        partial: 1,
        missing: 1,
        eligibleFinalized: 2,
        inFlight: 2,
        rate: 0,
        legacyRecordCount: 0,
      },
      runtimes: [
        {
          runtimeId: 'codex',
          runtimeLabel: 'Codex',
          recordedTokens: null,
          inputTokens: null,
          outputTokens: null,
          calls: 2,
          completeCalls: 0,
          partialCalls: 1,
          missingCalls: 1,
          legacyCalls: 0,
          inFlightCalls: 2,
          coverageRate: 0,
          models: [],
        },
      ],
      series: [{ date: '2026-09-15', runtimes: { codex: 25 } }],
    });

    const { merged } = aggregateRuntimeUsage([
      { backendId: 'a', name: 'A', payload: a },
      { backendId: 'b', name: 'B', payload: b },
    ]);
    expect(merged!.totals.recordedTokens).toBe(100); // null codex stays null-aware
    expect(merged!.totals.legacyTokens).toBe(40);
    expect(merged!.coverage.eligibleFinalized).toBe(4);
    expect(merged!.coverage.complete).toBe(1);
    // Percentages recompute from merged numerators/denominators, never averaged
    // (0.5 and 0 average to 0.5 — but 1/4 is 0.25).
    expect(merged!.coverage.rate).toBeCloseTo(0.25);
    expect(merged!.coverage.inFlight).toBe(2);
    expect(merged!.series).toEqual([{ date: '2026-09-15', runtimes: { claude: 100, codex: 25 } }]);
    expect(merged!.runtimes.map(r => r.runtimeId)).toEqual(['claude', 'codex']);
  });
});
