// Prompt-cache statistics shared by the server ledger queries and the desktop
// merge/render paths. One formula everywhere:
//   hit rate = cacheRead / (inputUncached + cacheRead + cacheWrite)
// token-weighted, writes in the denominator (otherwise cold-start turns hide).

/**
 * Input-side token sums for invocations that reported all three buckets.
 * Rows with any unknown bucket are excluded, never zero-filled.
 */
export interface CacheTokenSums {
  inputUncached: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface CacheShares {
  read: number;
  write: number;
  uncached: number;
}

export function emptyCacheSums(): CacheTokenSums {
  return { inputUncached: 0, cacheRead: 0, cacheWrite: 0 };
}

/** The three buckets of one usage breakdown, or null when any is unknown. */
export function cacheSumsFromBreakdown(tokens: {
  inputUncached?: number | null;
  cacheRead?: number | null;
  cacheWrite?: number | null;
}): CacheTokenSums | null {
  const { inputUncached, cacheRead, cacheWrite } = tokens;
  if (
    typeof inputUncached !== 'number' ||
    typeof cacheRead !== 'number' ||
    typeof cacheWrite !== 'number'
  ) {
    return null;
  }
  return { inputUncached, cacheRead, cacheWrite };
}

export function addCacheSums(a: CacheTokenSums, b: CacheTokenSums): CacheTokenSums {
  return {
    inputUncached: a.inputUncached + b.inputUncached,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

/**
 * Merge sums from several payloads. Undefined when any source lacks the field
 * (a backend predating cache stats) so the UI shows '—' instead of a partial
 * number dressed up as the whole.
 */
export function sumCacheSums(
  sources: ReadonlyArray<CacheTokenSums | undefined>
): CacheTokenSums | undefined {
  if (sources.length === 0) return undefined;
  let acc = emptyCacheSums();
  for (const source of sources) {
    if (!source) return undefined;
    acc = addCacheSums(acc, source);
  }
  return acc;
}

export function cacheInputTotal(sums: CacheTokenSums): number {
  return sums.inputUncached + sums.cacheRead + sums.cacheWrite;
}

/** Read share of the input side; null when nothing was recorded. */
export function cacheHitRate(sums: CacheTokenSums | undefined | null): number | null {
  if (!sums) return null;
  const total = cacheInputTotal(sums);
  return total > 0 ? sums.cacheRead / total : null;
}

export function cacheShares(sums: CacheTokenSums | undefined | null): CacheShares | null {
  if (!sums) return null;
  const total = cacheInputTotal(sums);
  if (total <= 0) return null;
  return {
    read: sums.cacheRead / total,
    write: sums.cacheWrite / total,
    uncached: sums.inputUncached / total,
  };
}

/**
 * Providers that don't support caching report 0/0 (pi-ai zero-fills), which is
 * indistinguishable from "all misses" — the UI says "No cache activity" then.
 */
export function hasCacheActivity(sums: CacheTokenSums | undefined | null): boolean {
  return !!sums && sums.cacheRead + sums.cacheWrite > 0;
}

// === Per-call cache timeline (GET /api/stats/sessions/:sessionId/cache-timeline) ===

/**
 * Why a call reused less of the prompt cache than the previous call wrote.
 * Run-boundary causes come from the per-run prefix fingerprint; the last
 * two are inferences when nothing else changed.
 */
export type CacheMissCause =
  | 'prompt_changed'
  | 'tools_changed'
  | 'model_changed'
  | 'thinking_changed'
  | 'compaction'
  | 'history_trimmed'
  | 'history_rewritten'
  | 'ttl_expired'
  | 'forked'
  | 'caching_disabled'
  /** Older history intact, nothing else changed: the previous run's own turn was re-shaped. */
  | 'previous_turn_rewritten'
  | 'unknown';

/** `cold` = nothing cacheable yet (a session's first traced call). */
export type CacheCallVerdict = 'cold' | 'hit' | 'partial' | 'miss';

export interface CacheTimelineCall {
  /** Usage-ledger invocation (one run). */
  invocationId: string;
  /** 0-based LLM call index within the run. */
  callIndex: number;
  at: number;
  model: string | null;
  tokens: CacheTokenSums;
  output: number;
  /** cacheRead ÷ the previous call's input side; null without a previous call. */
  reuse: number | null;
  verdict: CacheCallVerdict;
  /** Populated for `partial` / `miss` (and `cold` after a fork). */
  causes: CacheMissCause[];
}

export interface SessionCacheTimeline {
  /** Oldest first; the newest calls when `truncated`. */
  calls: CacheTimelineCall[];
  truncated: boolean;
}
