import { describe, it, expect } from 'vitest';
import { buildHeatmapWeeks, formatHour, funLine, heatmapLevel } from '../usageStats';

describe('heatmapLevel', () => {
  it('is 0 for zero and scales 1..4 relative to the max', () => {
    expect(heatmapLevel(0, 20)).toBe(0);
    expect(heatmapLevel(1, 20)).toBe(1);
    expect(heatmapLevel(10, 20)).toBe(2);
    expect(heatmapLevel(15, 20)).toBe(3);
    expect(heatmapLevel(20, 20)).toBe(4);
  });

  it('treats any activity as level 1 minimum even with max 1', () => {
    expect(heatmapLevel(1, 1)).toBe(4);
    expect(heatmapLevel(0, 1)).toBe(0);
  });
});

describe('buildHeatmapWeeks', () => {
  // 2026-07-04 is a Saturday.
  const today = '2026-07-04';

  it('produces the requested number of week columns of 7 cells each', () => {
    const weeks = buildHeatmapWeeks([], today, 26);
    expect(weeks).toHaveLength(26);
    for (const week of weeks) expect(week).toHaveLength(7);
  });

  it('places counts on the right cells and nulls future days', () => {
    const weeks = buildHeatmapWeeks([{ date: '2026-07-03', count: 5 }], today, 2);
    const last = weeks[1];
    // Week starts Sunday: 2026-06-28(Sun) .. 2026-07-04(Sat)
    expect(last[5]).toEqual({ date: '2026-07-03', count: 5, level: 4 });
    expect(last[6]?.date).toBe('2026-07-04'); // today itself is a real cell
    const first = weeks[0];
    expect(first[0]?.date).toBe('2026-06-21');
  });

  it('marks days before the window start as null', () => {
    const weeks = buildHeatmapWeeks([], '2026-07-01', 1); // Wednesday
    // Window is the current week only: Sun .. Wed real, Thu-Sat future -> null
    expect(weeks[0][3]?.date).toBe('2026-07-01');
    expect(weeks[0][4]).toBeNull();
  });
});

describe('formatHour', () => {
  it('formats 12-hour labels', () => {
    expect(formatHour(0)).toBe('12 AM');
    expect(formatHour(9)).toBe('9 AM');
    expect(formatHour(12)).toBe('12 PM');
    expect(formatHour(23)).toBe('11 PM');
  });
});

describe('funLine', () => {
  it('picks the largest reference at least 2x below the total', () => {
    expect(funLine(40_000_000)).toContain('War and Peace');
    expect(funLine(200_000)).toContain('The Great Gatsby'); // 200k/65k ≈ 3.1×, largest ref clearing 2×
    expect(funLine(50_000)).toContain('The Little Prince'); // only the smallest ref clears 2×
  });

  it('includes a rounded multiplier', () => {
    expect(funLine(40_000_000)).toContain('~53×');
  });

  it('returns null below the 2x floor', () => {
    expect(funLine(30_000)).toBeNull();
    expect(funLine(0)).toBeNull();
  });
});
