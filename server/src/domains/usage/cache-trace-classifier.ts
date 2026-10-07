import {
  cacheInputTotal,
  type CacheCallVerdict,
  type CacheMissCause,
  type CacheTimelineCall,
  type CacheTokenSums,
  type SessionCacheTimeline,
} from '@zclaudia/shared/core/cache-stats';

/** Per-run prefix fingerprint (prompt_cache_runs). */
export interface TraceRun {
  invocationId: string;
  startedAt: number;
  model: string | null;
  thinkingLevel: string | null;
  /** Profile cache retention; null = provider default ('short'). */
  cacheRetention: string | null;
  promptHash: string;
  toolsHash: string;
  /** Previous run's history survived as this run's prefix; null on the first traced run. */
  historyPrefixIntact: boolean | null;
  trimmedMessages: number;
}

/** One LLM call (prompt_cache_calls). */
export interface TraceCall {
  invocationId: string;
  callIndex: number;
  at: number;
  model: string | null;
  tokens: CacheTokenSums;
  output: number;
}

export interface TraceContext {
  /** The session was forked from another one (fresh provider cache key). */
  forked: boolean;
  /** Compaction entry timestamps from the session tree. */
  compactionsAt: number[];
}

/** Reuse ratio at or above which a call counts as a hit / partial hit. */
const HIT_REUSE = 0.8;
const PARTIAL_REUSE = 0.3;

const MINUTE = 60_000;

/** Provider cache lifetime per retention setting (Anthropic 5 min / 1 h). */
function ttlMs(retention: string | null): number {
  return retention === 'long' ? 60 * MINUTE : 5 * MINUTE;
}

/**
 * Classify every traced call of a session against the call before it.
 *
 * A provider caches the prompt prefix it just processed, so call N should
 * read back roughly call N-1's input side. When it reads much less, the
 * cause is looked up at the boundary: prefix fingerprint changes between
 * runs, a compaction or trimmed/rewritten history, or the cache TTL lapsing.
 * When the older history is intact and nothing else changed, the previous
 * run's own turn must have been re-shaped on the way back into history.
 *
 * Classification walks the whole session; only the newest `limit` calls are
 * returned (their baseline may be an omitted call).
 */
export function classifyCacheTimeline(
  runs: TraceRun[],
  calls: TraceCall[],
  context: TraceContext,
  limit = Number.POSITIVE_INFINITY
): SessionCacheTimeline {
  const runOrder = [...runs].sort((a, b) => a.startedAt - b.startedAt);
  const runById = new Map(runOrder.map(r => [r.invocationId, r]));
  const rank = new Map(runOrder.map((r, i) => [r.invocationId, i]));
  const ordered = calls
    .filter(c => runById.has(c.invocationId))
    .sort(
      (a, b) =>
        (rank.get(a.invocationId) ?? 0) - (rank.get(b.invocationId) ?? 0) ||
        a.callIndex - b.callIndex
    );

  const out: CacheTimelineCall[] = [];
  let prev: TraceCall | null = null;
  for (const current of ordered) {
    const run = runById.get(current.invocationId) as TraceRun;
    const prevRun = prev ? (runById.get(prev.invocationId) ?? null) : null;
    const expected = prev ? cacheInputTotal(prev.tokens) : 0;
    const reuse = prev && expected > 0 ? Math.min(1, current.tokens.cacheRead / expected) : null;

    let verdict: CacheCallVerdict;
    let causes: CacheMissCause[] = [];
    if (reuse === null) {
      verdict = 'cold';
      if (!prev && context.forked) causes = ['forked'];
    } else {
      verdict = reuse >= HIT_REUSE ? 'hit' : reuse >= PARTIAL_REUSE ? 'partial' : 'miss';
      if (verdict !== 'hit' && prev && prevRun) {
        causes = explainShortfall(current, run, prev, prevRun, context);
      }
    }
    out.push({
      invocationId: current.invocationId,
      callIndex: current.callIndex,
      at: current.at,
      model: current.model,
      tokens: current.tokens,
      output: current.output,
      reuse,
      verdict,
      causes,
    });
    prev = current;
  }

  const truncated = out.length > limit;
  return { calls: truncated ? out.slice(out.length - limit) : out, truncated };
}

function explainShortfall(
  current: TraceCall,
  run: TraceRun,
  prev: TraceCall,
  prevRun: TraceRun,
  context: TraceContext
): CacheMissCause[] {
  if (run.cacheRetention === 'none') return ['caching_disabled'];
  const causes: CacheMissCause[] = [];
  const runBoundary = current.invocationId !== prev.invocationId;
  const expired = current.at - prev.at > ttlMs(prevRun.cacheRetention);

  if (runBoundary) {
    if (run.promptHash !== prevRun.promptHash) causes.push('prompt_changed');
    if (run.toolsHash !== prevRun.toolsHash) causes.push('tools_changed');
    if (run.model !== prevRun.model) causes.push('model_changed');
    if (run.thinkingLevel !== prevRun.thinkingLevel) causes.push('thinking_changed');
    if (context.compactionsAt.some(t => t > prev.at && t <= current.at)) {
      causes.push('compaction');
    } else if (run.historyPrefixIntact === false) {
      causes.push(run.trimmedMessages > 0 ? 'history_trimmed' : 'history_rewritten');
    }
    if (expired) causes.push('ttl_expired');
    if (causes.length === 0 && run.historyPrefixIntact === true) {
      return ['previous_turn_rewritten'];
    }
  } else {
    if (current.model !== prev.model) causes.push('model_changed');
    if (expired) causes.push('ttl_expired');
  }
  return causes.length > 0 ? causes : ['unknown'];
}
