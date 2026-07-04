import type { ModelUsageDay } from '@zclaudia/shared';

export interface ModelChartBar {
  date: string;
  total: number;
  /** Ordered by the caller's model ranking (largest share first). */
  segments: Array<{ model: string; value: number }>;
}

export interface ModelChartData {
  bars: ModelChartBar[];
  /** Ascending, starts at 0, ends at scaleMax. */
  ticks: number[];
  scaleMax: number;
}

const DAY_MS = 86_400_000;

function localDateString(ms: number): string {
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Round a maximum up to a 1/2/2.5/5 x 10^n "nice" ceiling. */
function niceCeil(value: number): number {
  if (value <= 0) return 0;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (value <= m * base) return m * base;
  }
  return 10 * base;
}

/** Heuristic display name: drop the claude- prefix and trailing date stamps,
 *  hyphens to spaces, title-case each part. Raw id belongs in a tooltip. */
export function prettyModelName(modelId: string): string {
  const parts = modelId
    .replace(/^claude-/, '')
    .replace(/-\d{8,}$/, '')
    .split('-')
    .filter(Boolean);
  return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

/** Stacked-bar geometry: continuous date axis (missing days = zero-total
 *  gaps), segments in the caller's rank order, nice y-axis ticks. */
export function buildModelChart(days: ModelUsageDay[], modelOrder: string[]): ModelChartData {
  if (days.length === 0) return { bars: [], ticks: [0], scaleMax: 0 };

  const byDate = new Map(days.map(d => [d.date, d.models]));
  const startMs = new Date(`${days[0].date}T12:00:00`).getTime();
  const endMs = new Date(`${days[days.length - 1].date}T12:00:00`).getTime();

  const bars: ModelChartBar[] = [];
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
    const date = localDateString(ms);
    const models = byDate.get(date);
    const segments = models
      ? modelOrder
          .filter(m => (models[m] ?? 0) > 0)
          .map(m => ({ model: m, value: models[m] }))
      : [];
    bars.push({
      date,
      total: segments.reduce((sum, s) => sum + s.value, 0),
      segments,
    });
  }

  const maxTotal = Math.max(...bars.map(b => b.total));
  const scaleMax = niceCeil(maxTotal);
  // All-zero windows collapse to a single tick — [0, 0, 0] would collide as
  // React keys and stack three gridlines on the baseline.
  const ticks = scaleMax > 0 ? [0, scaleMax / 2, scaleMax] : [0];
  return { bars, ticks, scaleMax };
}
