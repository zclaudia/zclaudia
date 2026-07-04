import type { UsageActiveDay } from '@zclaudia/shared';

export interface HeatmapCell {
  date: string;
  count: number;
  /** 0 = idle, 1..4 = activity intensity relative to the window max. */
  level: number;
}

const DAY_MS = 86_400_000;

/** Intensity bucket for a day, relative to the busiest day in the window. */
export function heatmapLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4)));
}

function localDateString(ms: number): string {
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * GitHub-style grid: `weeks` columns of 7 cells (Sunday-first). The last
 * column is the current week; cells after `today` are null (future).
 */
export function buildHeatmapWeeks(
  activeDays: UsageActiveDay[],
  today: string,
  weeks: number
): Array<Array<HeatmapCell | null>> {
  const counts = new Map(activeDays.map(d => [d.date, d.count]));
  const max = Math.max(0, ...activeDays.map(d => d.count));
  const todayMs = new Date(`${today}T12:00:00`).getTime();
  const todayDow = new Date(todayMs).getDay(); // 0 = Sunday
  const lastWeekStartMs = todayMs - todayDow * DAY_MS;

  const grid: Array<Array<HeatmapCell | null>> = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const weekStartMs = lastWeekStartMs - w * 7 * DAY_MS;
    const column: Array<HeatmapCell | null> = [];
    for (let d = 0; d < 7; d++) {
      const cellMs = weekStartMs + d * DAY_MS;
      if (cellMs > todayMs) {
        column.push(null);
        continue;
      }
      const date = localDateString(cellMs);
      const count = counts.get(date) ?? 0;
      column.push({ date, count, level: heatmapLevel(count, max) });
    }
    grid.push(column);
  }
  return grid;
}

/** 0-23 -> '9 AM' / '12 PM' style label. */
export function formatHour(hour: number): string {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${suffix}`;
}

/** Transpose the column-major weeks grid into row-major cells for a CSS grid
 *  that fills the container width with one fr column per week. */
export function flattenRowMajor(
  weeks: Array<Array<HeatmapCell | null>>
): Array<HeatmapCell | null> {
  const cells: Array<HeatmapCell | null> = [];
  for (let day = 0; day < 7; day++) {
    for (const week of weeks) cells.push(week[day] ?? null);
  }
  return cells;
}

/** Length-stepped font-size class for a metric-card value: numbers and short
 *  model names render large, longer names step down instead of truncating.
 *  Line height is pinned to the text-lg line box so the tiles stay equal. */
export function cardValueClass(value: string): string {
  if (value.length <= 8) return 'text-lg';
  if (value.length <= 13) return 'text-sm leading-7';
  if (value.length <= 18) return 'text-xs leading-7';
  return 'text-[11px] leading-7';
}

/** Reference corpora for the fun comparison line, ascending by size. */
const REFERENCES: Array<{ name: string; tokens: number }> = [
  { name: 'The Little Prince', tokens: 20_000 },
  { name: 'The Great Gatsby', tokens: 65_000 },
  { name: '1984', tokens: 120_000 },
  { name: 'Moby-Dick', tokens: 280_000 },
  { name: 'The Lord of the Rings', tokens: 600_000 },
  { name: 'War and Peace', tokens: 750_000 },
];

/** "You've used ~N× more tokens than <book>." — rotates daily among the
 *  references whose multiplier lands in [2, 9999]; null when none qualify.
 *  `dayKey` ('YYYY-MM-DD') keeps the pick deterministic and testable. */
export function funLine(totalTokens: number, dayKey: string): string | null {
  const eligible = REFERENCES.filter(ref => {
    const multiplier = totalTokens / ref.tokens;
    return multiplier >= 2 && multiplier <= 9999;
  });
  if (eligible.length === 0) return null;
  let hash = 0;
  for (const ch of dayKey) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const pick = eligible[hash % eligible.length];
  const multiplier = Math.round(totalTokens / pick.tokens);
  return `You've used ~${multiplier}× more tokens than ${pick.name}.`;
}
