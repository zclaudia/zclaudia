import { useState, useRef, useCallback, type ReactNode } from 'react';
import type { ContextUsagePayload } from '@zclaudia/shared/core/message';
import type { SessionCacheStats } from '@zclaudia/shared/core/usage-stats';
import { cacheInputTotal, hasCacheActivity } from '@zclaudia/shared/core/cache-stats';
import { getSessionCacheStats, getSessionContextUsage } from '../../services/api';
import { ContextUsageCard } from './ContextUsageCard';
import { formatTokens } from '../../utils/formatTokens';
import { SECTION_LABEL } from '../../components/ui/typography';
import { CacheBreakdownBar } from '../../components/usage/CacheBreakdownBar';
import { formatHitRate } from '../../components/usage/cacheFormat';
import { useIsMounted } from '../../hooks/useIsMounted';
import { useLatestRef } from '../../hooks/useLatestRef';
import { HoverPopover } from '../../components/ui/HoverPopover';

interface Props {
  sessionId: string;
  children: ReactNode;
  /** Cache-read tokens for the latest run (live store value, not in the snapshot). */
  latestCacheRead?: number;
}

type FetchState =
  | { status: 'loading' }
  | { status: 'available'; usage: ContextUsagePayload }
  /** `supported: false` — the runtime never reports a breakdown (external CLIs). */
  | { status: 'unavailable'; supported: boolean }
  | { status: 'error' };

/** Ledger cache sums; `null` = not loaded or unsupported (older backend). */
type CacheState = SessionCacheStats | null;

/**
 * Popover that reveals the full /context breakdown panel from the compact
 * input-box indicator. Wraps the trigger (`children`), fetches the server
 * snapshot on open, and renders the shared ContextUsageCard in a HoverPopover.
 */
export function ContextUsagePopover({ sessionId, children, latestCacheRead }: Props) {
  const [state, setState] = useState<FetchState | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheState>(null);
  const cacheStatsRef = useRef<Map<string, SessionCacheStats>>(new Map());
  // Per-session stale-while-revalidate cache so re-hovering doesn't white-flash.
  const cacheRef = useRef<Map<string, ContextUsagePayload>>(new Map());
  const isMounted = useIsMounted();
  // Always holds the latest sessionId so an in-flight fetch can detect that the
  // component was re-pointed at a different session (it updates in place rather
  // than remounting) and drop its now-stale result.
  const sessionIdRef = useLatestRef(sessionId);

  // Independent of the context snapshot: the ledger covers every runtime and
  // survives restarts, so the section can show even when the breakdown can't.
  const fetchCache = useCallback(async () => {
    const sid = sessionId;
    setCacheStats(cacheStatsRef.current.get(sid) ?? null);
    try {
      const stats = await getSessionCacheStats(sid);
      if (!isMounted() || sid !== sessionIdRef.current) return;
      cacheStatsRef.current.set(sid, stats);
      setCacheStats(stats);
    } catch {
      // Older backend without the endpoint: keep the live single-turn line.
      if (!isMounted() || sid !== sessionIdRef.current) return;
      setCacheStats(null);
    }
  }, [isMounted, sessionId, sessionIdRef]);

  const doFetch = useCallback(async () => {
    const sid = sessionId;
    const cached = cacheRef.current.get(sid);
    setState(cached ? { status: 'available', usage: cached } : { status: 'loading' });
    try {
      const res = await getSessionContextUsage(sid);
      // Drop the result if we unmounted or switched sessions mid-flight.
      if (!isMounted() || sid !== sessionIdRef.current) return;
      if (!res.available) {
        setState({ status: 'unavailable', supported: res.supported !== false });
        return;
      }
      const { available: _available, ...usage } = res;
      cacheRef.current.set(sid, usage);
      setState({ status: 'available', usage });
    } catch {
      if (!isMounted() || sid !== sessionIdRef.current) return;
      setState({ status: 'error' });
    }
  }, [isMounted, sessionId, sessionIdRef]);

  return (
    <HoverPopover
      onOpen={() => {
        void doFetch();
        void fetchCache();
      }}
      panelTestId="context-usage-popover"
      content={
        <PopoverBody state={state} cacheStats={cacheStats} latestCacheRead={latestCacheRead} />
      }
    >
      {children}
    </HoverPopover>
  );
}

function PopoverBody({
  state,
  cacheStats,
  latestCacheRead,
}: {
  state: FetchState | null;
  cacheStats: CacheState;
  latestCacheRead?: number;
}) {
  const showCacheSection = !!cacheStats && cacheInputTotal(cacheStats.session) > 0;
  return (
    <>
      {state?.status === 'available' && (
        <>
          <ContextUsageCard usage={state.usage} bare />
          {!showCacheSection && (latestCacheRead ?? 0) > 0 && (
            <div
              data-testid="popover-cache-line"
              className="border-t border-border/40 px-3 py-2 text-[10px] text-muted-foreground"
            >
              ↺ Prompt cache: {formatTokens(latestCacheRead ?? 0, { decimals: 0, upper: true })}{' '}
              read this turn
            </div>
          )}
        </>
      )}
      {state?.status === 'loading' && (
        <div className="px-3 py-2.5 text-xs text-muted-foreground">Loading context usage…</div>
      )}
      {state?.status === 'unavailable' && (
        <div
          data-testid="context-usage-popover-empty"
          className="px-3 py-2.5 text-xs text-muted-foreground"
        >
          {state.supported
            ? 'No context data yet — send a message first.'
            : "Context breakdown isn't available for this runtime."}
        </div>
      )}
      {state?.status === 'error' && (
        <div className="px-3 py-2.5 text-xs text-destructive">Failed to load context usage.</div>
      )}
      {showCacheSection && state && state.status !== 'loading' && (
        <SessionCacheSection stats={cacheStats} />
      )}
    </>
  );
}

/** Session-wide prompt-cache split from the usage ledger (all runtimes). */
function SessionCacheSection({ stats }: { stats: SessionCacheStats }) {
  const active = hasCacheActivity(stats.session);
  return (
    <div data-testid="popover-cache-section" className="border-t border-border/40 px-3 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className={SECTION_LABEL}>Prompt cache</span>
        {active && (
          <span className="text-2xs text-muted-foreground">
            <span className="font-medium text-foreground">{formatHitRate(stats.session)}</span> hit
            this session
          </span>
        )}
      </div>
      {active ? (
        <>
          <div className="mt-1.5">
            <CacheBreakdownBar sums={stats.session} compact />
          </div>
          {stats.latestRun && (
            <p className="mt-1 text-3xs text-muted-foreground/60">
              Last run {formatHitRate(stats.latestRun)} hit · {stats.runs}{' '}
              {stats.runs === 1 ? 'run' : 'runs'}
            </p>
          )}
        </>
      ) : (
        <p className="mt-1 text-3xs text-muted-foreground/60">No cache activity in this session.</p>
      )}
    </div>
  );
}
