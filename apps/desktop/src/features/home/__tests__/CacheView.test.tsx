import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ModelUsagePayload, RuntimeUsagePayload } from '@zclaudia/shared/core/usage-stats';
import type { CacheTokenSums } from '@zclaudia/shared/core/cache-stats';
import { CacheView } from '../CacheView';

function runtimePayload(
  datasetId: string,
  cache: CacheTokenSums | undefined,
  rows: Array<{ runtimeId: string; cache?: CacheTokenSums }> = []
): RuntimeUsagePayload {
  return {
    schemaVersion: 1,
    datasetId,
    asOf: 1,
    timeZone: 'UTC',
    accountingSince: 1,
    accountingActive: true,
    capturedAt: 1,
    totals: {
      recordedTokens: 1,
      completeTokens: 1,
      partialTokens: null,
      legacyTokens: null,
      activeRecordedTokens: null,
      ...(cache ? { cache } : {}),
    },
    coverage: {
      complete: 1,
      partial: 0,
      missing: 0,
      eligibleFinalized: 1,
      inFlight: 0,
      rate: 1,
      legacyRecordCount: 0,
    },
    runtimes: rows.map(row => ({
      runtimeId: row.runtimeId,
      runtimeLabel: null,
      recordedTokens: 1,
      inputTokens: 1,
      outputTokens: 0,
      calls: 1,
      completeCalls: 1,
      partialCalls: 0,
      missingCalls: 0,
      legacyCalls: 0,
      inFlightCalls: 0,
      coverageRate: 1,
      models: [],
      ...(row.cache ? { cache: row.cache } : {}),
    })),
    series: cache ? [{ date: '2026-10-07', runtimes: { pi: 1 }, cache }] : [],
  };
}

const models = (entries: Array<[string, CacheTokenSums]>): ModelUsagePayload => ({
  datasetId: 'ds-1',
  days: [],
  trackedSince: null,
  capturedAt: 1,
  models: entries.map(([model, cache]) => ({
    model,
    inTokens: 1,
    outTokens: 0,
    totalTokens: 1,
    share: 1,
    cache,
  })),
});

describe('CacheView', () => {
  const warm = { inputUncached: 100, cacheRead: 800, cacheWrite: 100 };

  it('shows the overall hit rate, breakdown, chart and per-runtime / per-model rows', () => {
    render(
      <CacheView
        runtimeSnapshots={{
          local: runtimePayload('ds-1', warm, [
            { runtimeId: 'pi', cache: warm },
            { runtimeId: 'cursor', cache: { inputUncached: 0, cacheRead: 0, cacheWrite: 0 } },
          ]),
        }}
        modelSnapshots={{ local: models([['claude-sonnet-4-5', warm]]) }}
      />
    );
    expect(screen.getByTestId('cache-hit-rate').textContent).toBe('80%');
    expect(screen.getByTestId('cache-breakdown')).toBeTruthy();
    expect(screen.getByTestId('cache-hit-chart')).toBeTruthy();
    const runtimeTable = screen.getByText('By runtime').parentElement!;
    expect(within(runtimeTable).getByText('Pi')).toBeTruthy();
    // Runtimes with an empty input side don't get a row.
    expect(within(runtimeTable).queryByText('Cursor')).toBeNull();
    expect(screen.getByText('By model')).toBeTruthy();
  });

  it('says "No cache activity" instead of 0% when the providers never cached', () => {
    const cold = { inputUncached: 500, cacheRead: 0, cacheWrite: 0 };
    render(
      <CacheView
        runtimeSnapshots={{
          local: runtimePayload('ds-1', cold, [{ runtimeId: 'pi', cache: cold }]),
        }}
        modelSnapshots={{}}
      />
    );
    expect(screen.getByTestId('cache-hit-rate').textContent).toBe('—');
    expect(screen.getByText(/No cache activity/)).toBeTruthy();
  });

  it('asks for an updated backend when cache sums are absent', () => {
    render(
      <CacheView
        runtimeSnapshots={{ local: runtimePayload('ds-1', undefined) }}
        modelSnapshots={{}}
      />
    );
    expect(screen.getByText('Cache stats need an updated backend.')).toBeTruthy();
  });

  it('reports an empty range', () => {
    render(
      <CacheView
        runtimeSnapshots={{
          local: runtimePayload('ds-1', { inputUncached: 0, cacheRead: 0, cacheWrite: 0 }),
        }}
        modelSnapshots={{}}
      />
    );
    expect(screen.getByText('No cache data recorded in this range yet.')).toBeTruthy();
  });

  it('merges backends from sums and notes backends without a capture', () => {
    render(
      <CacheView
        runtimeSnapshots={{
          a: runtimePayload('ds-a', { inputUncached: 0, cacheRead: 90, cacheWrite: 10 }),
          b: runtimePayload('ds-b', { inputUncached: 900, cacheRead: 0, cacheWrite: 100 }),
          c: undefined,
        }}
        modelSnapshots={{}}
      />
    );
    // 90 / 1100, not the 45% average of 90% and 0%.
    expect(screen.getByTestId('cache-hit-rate').textContent).toBe('8%');
    expect(screen.getByText('1 backend without cache stats excluded')).toBeTruthy();
  });
});
