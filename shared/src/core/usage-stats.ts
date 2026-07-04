// Usage statistics for the Home page stats strip.

export interface UsageActiveDay {
  /** Local date, 'YYYY-MM-DD' (server timezone). */
  date: string;
  /** User messages sent that day. */
  count: number;
}

export interface UsageStatsPayload {
  /** All sessions ever created (archived included). */
  sessions: number;
  /** All messages, any role. */
  messages: number;
  /** Sum of assistant-message metadata.usage.totalTokens. */
  totalTokens: number;
  /** Consecutive active days ending today (or yesterday when today is idle so far). */
  currentStreakDays: number;
  /** Days with >=1 user message, last 182 days (26 weeks) only, ascending. */
  activeDays: UsageActiveDay[];
  capturedAt: number;
}
