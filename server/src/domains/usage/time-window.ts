import type { UsageStatsRange } from '@zclaudia/shared/core/usage-stats';

/**
 * Timezone-aware statistics windows (design §8): 7d/30d are calendar days
 * INCLUDING today in the user's IANA timezone; the server computes UTC
 * bounds so DST shifts keep every day exactly one local day long.
 */
export interface UsageWindow {
  /** Inclusive UTC lower bound (ms), 0 for 'all'. */
  startUtcMs: number;
  /** Exclusive UTC upper bound (ms). */
  endUtcMs: number;
  timeZone: string;
}

const DAY_MS = 86_400_000;
// Constructing an Intl formatter per ledger row dominates large-history queries.
const formatters = new Map<string, Intl.DateTimeFormat>();

function zonedParts(
  timeZone: string,
  ms: number
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    if (formatters.size >= 32) formatters.clear();
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(ms));
  const read = (type: string): number => Number(parts.find(p => p.type === type)?.value ?? '0');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

/** Offset (ms) between the zone's wall-clock time and UTC at the instant. */
function zoneOffsetMs(timeZone: string, ms: number): number {
  const p = zonedParts(timeZone, ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** UTC ms of local midnight for a calendar date in the zone (DST-safe). */
export function zonedDayStartUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number
): number {
  const guess = Date.UTC(year, month - 1, day);
  // Iterate to a fixed point: the zone offset must be sampled AT the
  // candidate instant, since the offset at noon can differ from the offset
  // at midnight across a DST transition (23h/25h days).
  let candidate = guess - zoneOffsetMs(timeZone, guess);
  for (let i = 0; i < 3; i++) {
    const refined = guess - zoneOffsetMs(timeZone, candidate);
    if (refined === candidate) break;
    candidate = refined;
  }
  return candidate;
}

/** 'YYYY-MM-DD' of a UTC instant in the zone. */
export function zonedDateKey(timeZone: string, ms: number): string {
  const p = zonedParts(timeZone, ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function addZonedDays(timeZone: string, dayStartMs: number, days: number): number {
  // Walk local-day boundaries. Anchored at MIDDAY of the current day, the
  // ±18h probe lands at 06:00/18:00 local of the adjacent day — never on the
  // same day, and never at midnight itself where a DST transition could
  // re-derive the same day.
  let current = dayStartMs;
  const direction = days > 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(days); i++) {
    const probe = current + DAY_MS / 2 + direction * DAY_MS * 0.75;
    const p = zonedParts(timeZone, probe);
    current = zonedDayStartUtc(timeZone, p.year, p.month, p.day);
  }
  return current;
}

/**
 * Resolve the query window for a range. 'all' covers everything retained.
 * Invalid time zones fall back to UTC rather than throwing — a bad client
 * parameter must not break the stats page.
 */
export function resolveUsageWindow(
  range: UsageStatsRange,
  timeZone: string | undefined,
  asOf: number
): UsageWindow {
  let zone = timeZone && timeZone.trim() ? timeZone.trim() : 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    zone = 'UTC';
  }
  if (range === 'all') {
    return { startUtcMs: 0, endUtcMs: asOf + 1, timeZone: zone };
  }
  const days = range === '7d' ? 7 : 30;
  const today = zonedParts(zone, asOf);
  const todayStart = zonedDayStartUtc(zone, today.year, today.month, today.day);
  const windowStart = addZonedDays(zone, todayStart, -(days - 1));
  const tomorrowStart = addZonedDays(zone, todayStart, 1);
  return {
    startUtcMs: windowStart,
    endUtcMs: Math.min(tomorrowStart, asOf + 1),
    timeZone: zone,
  };
}
