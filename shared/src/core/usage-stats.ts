// Usage statistics for the Home page stats strip.

export interface UsageActiveDay {
  /** Local date, 'YYYY-MM-DD' (server timezone). */
  date: string;
  /** User messages sent that day. */
  count: number;
}

export type UsageStatsRange = 'all' | '30d' | '7d';

export interface UsageStatsPayload {
  /** Sessions created within the range (archived included). */
  sessions: number;
  /** Messages created within the range, any role. */
  messages: number;
  /** Assistant usage tokens within the range. */
  totalTokens: number;
  /** Distinct active days within the range. */
  activeDaysCount: number;
  /** Consecutive active days ending today — range-independent. */
  currentStreakDays: number;
  /** Longest consecutive run within the range ('all' bounded by the 182d data window). */
  longestStreakDays: number;
  /** 0-23 mode of user-message local hour within the range; null when no user messages. */
  peakHour: number | null;
  /** All-time assistant tokens (for the fun line) — range-independent. */
  allTimeTokens: number;
  /** Days with >=1 user message, ALWAYS the full 182-day window (heatmap), ascending. */
  activeDays: UsageActiveDay[];
  capturedAt: number;
}

export interface ModelUsageDay {
  /** Local date, 'YYYY-MM-DD' (server timezone). */
  date: string;
  /** Per-model totalTokens for the day. */
  models: Record<string, number>;
}

export interface ModelUsageTotal {
  model: string;
  /** totalTokens − output within the window (prompt side incl. cache). */
  inTokens: number;
  outTokens: number;
  totalTokens: number;
  /** Fraction of the window's grand total, in [0, 1]. */
  share: number;
}

export interface ModelUsagePayload {
  /** Ascending; only days that have model-tagged usage. */
  days: ModelUsageDay[];
  /** Descending by share. */
  models: ModelUsageTotal[];
  /** MIN(created_at) of model-tagged assistant messages (all-time); null when none. */
  trackedSince: number | null;
  capturedAt: number;
}
