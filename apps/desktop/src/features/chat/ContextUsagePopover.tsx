import { useState, useRef, useCallback, type ReactNode } from 'react';
import type { ContextUsagePayload } from '@zclaudia/shared/core/message';
import { getSessionContextUsage } from '../../services/api';
import { ContextUsageCard } from './ContextUsageCard';
import { formatTokens } from '../../utils/formatTokens';
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

/**
 * Popover that reveals the full /context breakdown panel from the compact
 * input-box indicator. Wraps the trigger (`children`), fetches the server
 * snapshot on open, and renders the shared ContextUsageCard in a HoverPopover.
 */
export function ContextUsagePopover({ sessionId, children, latestCacheRead }: Props) {
  const [state, setState] = useState<FetchState | null>(null);
  // Per-session stale-while-revalidate cache so re-hovering doesn't white-flash.
  const cacheRef = useRef<Map<string, ContextUsagePayload>>(new Map());
  const isMounted = useIsMounted();
  // Always holds the latest sessionId so an in-flight fetch can detect that the
  // component was re-pointed at a different session (it updates in place rather
  // than remounting) and drop its now-stale result.
  const sessionIdRef = useLatestRef(sessionId);

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
      onOpen={() => void doFetch()}
      panelTestId="context-usage-popover"
      content={<PopoverBody state={state} latestCacheRead={latestCacheRead} />}
    >
      {children}
    </HoverPopover>
  );
}

function PopoverBody({
  state,
  latestCacheRead,
}: {
  state: FetchState | null;
  latestCacheRead?: number;
}) {
  return (
    <>
      {state?.status === 'available' && (
        <>
          <ContextUsageCard usage={state.usage} bare />
          {(latestCacheRead ?? 0) > 0 && (
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
    </>
  );
}
