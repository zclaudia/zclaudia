import { describe, it, expect } from 'vitest';
import {
  buildHeatmapWeeks,
  flattenRowMajor,
  formatHour,
  funLine,
  heatmapLevel,
} from '../usageStats';

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

describe('flattenRowMajor', () => {
  it('transposes column-major weeks into row-major cells', () => {
    const weeks = buildHeatmapWeeks([{ date: '2026-07-03', count: 5 }], '2026-07-04', 2);
    const flat = flattenRowMajor(weeks);
    expect(flat).toHaveLength(14);
    // Row-major: first two cells are the Sunday of week 0 then week 1.
    expect(flat[0]?.date).toBe('2026-06-21');
    expect(flat[1]?.date).toBe('2026-06-28');
    // Friday row (index 5): week1's cell is 2026-07-03 with the count.
    expect(flat[5 * 2 + 1]).toEqual({ date: '2026-07-03', count: 5, level: 4 });
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
  it('rotates deterministically among eligible references by day key', () => {
    // 40M tokens: every book in the pool clears 2x and stays under 9999x,
    // so all six are eligible and the pick depends only on the day key.
    const a = funLine(40_000_000, '2026-07-04');
    const b = funLine(40_000_000, '2026-07-04');
    expect(a).toBe(b); // deterministic for the same day
    const week = Array.from({ length: 7 }, (_, i) =>
      funLine(40_000_000, `2026-07-0${i + 1}`)
    );
    expect(new Set(week).size).toBeGreaterThan(1); // varies across days
  });

  it('includes a rounded multiplier for the picked reference', () => {
    const line = funLine(40_000_000, '2026-07-04');
    expect(line).toMatch(/~\d+× more tokens than/);
  });

  it('excludes references outside the 2x..9999x multiplier band', () => {
    // 50k tokens: only The Little Prince (20k) clears 2x.
    for (let day = 1; day <= 9; day++) {
      expect(funLine(50_000, `2026-07-0${day}`)).toContain('The Little Prince');
    }
    // 300M tokens: Little Prince would be 15000x (over cap) — never picked.
    for (let day = 1; day <= 9; day++) {
      expect(funLine(300_000_000, `2026-07-0${day}`)).not.toContain('The Little Prince');
    }
  });

  it('returns null below the 2x floor', () => {
    expect(funLine(30_000, '2026-07-04')).toBeNull();
    expect(funLine(0, '2026-07-04')).toBeNull();
  });
});
