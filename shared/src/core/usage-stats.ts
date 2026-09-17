// Usage statistics for the Home page stats strip.

export interface UsageActiveDay {
  /** Local date, 'YYYY-MM-DD' (server timezone). */
  date: string;
  /** User messages sent that day. */
  count: number;
}

export type UsageStatsRange = 'all' | '30d' | '7d';

export interface UsageStatsPayload {
  datasetId?: string;
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
  /** Model id with the highest token total within the range (models recorded
   *  from 2026-07 on); null when no model-tagged messages exist in the window. */
  favoriteModel: string | null;
  /** All-time assistant tokens (for the fun line) — range-independent. */
  allTimeTokens: number;
  /** Days with >=1 user message, ALWAYS the full 182-day window (heatmap), ascending. */
  activeDays: UsageActiveDay[];
  capturedAt: number;
  /**
   * Ledger-backed accounting summary (runtime usage records). Present only
   * when the runtime usage ledger is active on this backend; older clients
   * ignore it.
   */
  accounting?: AccountingSummary;
}

/**
 * Ledger accounting summary projected onto the legacy usage payload so the
 * Overview strip can say "Recorded tokens" plus coverage without a second
 * round trip.
 */
export interface AccountingSummary {
  active: true;
  /** Sum of known totals (complete + partial + legacy). null when nothing recorded. */
  recordedTokens: number | null;
  /** complete / eligible finalized invocations within the window. */
  completeCalls: number;
  partialCalls: number;
  missingCalls: number;
  eligibleFinalized: number;
  inFlightCalls: number;
  legacyRecords: number;
  /** Epoch ms the ledger started recording new invocations; null before activation. */
  accountingSince: number | null;
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
  datasetId?: string;
  /** Ascending; only days that have model-tagged usage. */
  days: ModelUsageDay[];
  /** Descending by share. */
  models: ModelUsageTotal[];
  /** MIN(created_at) of model-tagged assistant messages (all-time); null when none. */
  trackedSince: number | null;
  capturedAt: number;
}

// === Runtime usage ledger payload (GET /api/stats/runtime-usage) ===

export type RuntimeUsageReportStatus = 'ok' | 'unsupported';

export interface RuntimeUsageRuntimeRow {
  /** Runtime descriptor id: pi | claude | codex | cursor | legacy-unknown. */
  runtimeId: string;
  /** Human label when the server knows one; null for unknown/legacy buckets. */
  runtimeLabel: string | null;
  /** Sum of known totals for this runtime; null when nothing recorded. */
  recordedTokens: number | null;
  /** Known input side (inputUncached + cacheRead + cacheWrite); null when incomplete. */
  inputTokens: number | null;
  /** Known output tokens; null when unknown. */
  outputTokens: number | null;
  /** Finalized invocations included in the coverage denominator. */
  calls: number;
  completeCalls: number;
  partialCalls: number;
  missingCalls: number;
  legacyCalls: number;
  inFlightCalls: number;
  /** complete / eligibleFinalized; null when the denominator is 0. */
  coverageRate: number | null;
  /** Per actual model (Unknown bucket = null modelId), known totals only. */
  models: Array<{ modelId: string | null; tokens: number }>;
}

export interface RuntimeUsageSeriesPoint {
  /** Local date 'YYYY-MM-DD' in the requested timeZone. */
  date: string;
  /** runtimeId → recorded tokens for that day (known values only). */
  runtimes: Record<string, number>;
}

/** Payload of GET /api/stats/runtime-usage. */
export interface RuntimeUsagePayload {
  schemaVersion: 1;
  /** Stable identity of the underlying database; used to dedupe merged backends. */
  datasetId: string;
  asOf: number;
  timeZone: string;
  /** Epoch ms the ledger started recording; null while accounting is inactive. */
  accountingSince: number | null;
  /** False when the backend predates the ledger: token stats stay legacy-only. */
  accountingActive: boolean;
  capturedAt: number;
  totals: {
    /** null when no known values at all (UI shows '—', not 0). */
    recordedTokens: number | null;
    completeTokens: number | null;
    partialTokens: number | null;
    legacyTokens: number | null;
    /** Known totals of invocations still running (reported separately). */
    activeRecordedTokens: number | null;
  };
  coverage: {
    complete: number;
    partial: number;
    missing: number;
    eligibleFinalized: number;
    inFlight: number;
    /** complete / eligibleFinalized; null when the denominator is 0. */
    rate: number | null;
    legacyRecordCount: number;
  };
  runtimes: RuntimeUsageRuntimeRow[];
  /** Ascending by date; one point per local day with recorded usage. */
  series: RuntimeUsageSeriesPoint[];
}
