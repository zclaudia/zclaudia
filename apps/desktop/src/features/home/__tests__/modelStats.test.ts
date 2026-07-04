import { describe, it, expect } from 'vitest';
import { buildModelChart, prettyModelName } from '../modelStats';

describe('prettyModelName', () => {
  it('strips claude prefix and date suffixes, title-cases the rest', () => {
    expect(prettyModelName('claude-fable-5')).toBe('Fable 5');
    expect(prettyModelName('deepseek-v4-flash')).toBe('Deepseek V4 Flash');
    expect(prettyModelName('claude-haiku-4-5-20251001')).toBe('Haiku 4 5');
    expect(prettyModelName('gpt-5o')).toBe('Gpt 5o');
  });
});

describe('buildModelChart', () => {
  const days = [
    { date: '2026-07-01', models: { a: 600, b: 400 } },
    { date: '2026-07-03', models: { a: 2000 } },
  ];

  it('builds a continuous date axis with zero-total gaps', () => {
    const chart = buildModelChart(days, ['a', 'b']);
    expect(chart.bars.map(b => b.date)).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
    expect(chart.bars[1].total).toBe(0);
    expect(chart.bars[1].segments).toEqual([]);
  });

  it('orders segments by the given model order and sums totals', () => {
    const chart = buildModelChart(days, ['a', 'b']);
    expect(chart.bars[0].segments).toEqual([
      { model: 'a', value: 600 },
      { model: 'b', value: 400 },
    ]);
    expect(chart.bars[0].total).toBe(1000);
  });

  it('produces nice ticks covering the max day', () => {
    const chart = buildModelChart(days, ['a', 'b']);
    expect(chart.scaleMax).toBeGreaterThanOrEqual(2000);
    expect(chart.ticks[0]).toBe(0);
    expect(chart.ticks[chart.ticks.length - 1]).toBe(chart.scaleMax);
    expect(chart.ticks).toHaveLength(3);
  });

  it('handles empty input', () => {
    const chart = buildModelChart([], []);
    expect(chart.bars).toEqual([]);
    expect(chart.scaleMax).toBe(0);
  });

  it('collapses ticks to a single zero when every day is zero-total', () => {
    // Zero-usage tagged rows yield all-zero days; duplicate tick values
    // would collide as React keys downstream.
    const chart = buildModelChart([{ date: '2026-07-01', models: { a: 0 } }], ['a']);
    expect(chart.ticks).toEqual([0]);
    expect(chart.scaleMax).toBe(0);
  });
});
