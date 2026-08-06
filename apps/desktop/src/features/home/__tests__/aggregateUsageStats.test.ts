import { describe, it, expect } from 'vitest';
import type { ModelUsagePayload, UsageStatsPayload } from '@zclaudia/shared';
import { aggregateUsageStats, aggregateModelStats } from '../aggregateUsageStats';

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
