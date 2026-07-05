import { useEffect, useRef, useState } from 'react';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';
import type { AgentsBackend } from './agents-types';

export interface CatalogByBackend<T> {
  data: Map<string, T>;
  errors: Map<string, string>;
  loading: boolean;
}

/**
 * Shared per-backend catalog fetcher: fetches `fetcher(backendId)` for each
 * ONLINE backend, refetches when agentsRefreshNonce bumps, isolates failures
 * per backend (a rejection becomes an error entry — never a data entry — and
 * doesn't affect other backends), and guards stale writes with a `cancelled`
 * flag per effect cycle.
 *
 * The fetcher does NOT need to be referentially stable: the effect is keyed on
 * [onlineKey, nonce] only, and the latest fetcher is kept in a ref, so passing
 * an inline closure never retriggers a fetch cycle — the next cycle (backend
 * set change or nonce bump) simply uses the most recent fetcher.
 */
export function useCatalogByBackend<T>(
  backends: AgentsBackend[],
  fetcher: (backendId: string) => Promise<T>
): CatalogByBackend<T> {
  const nonce = useTopLevelViewStore(s => s.agentsRefreshNonce);

  // Keep the latest fetcher in a ref. Synced via an effect declared BEFORE the
  // fetch effect so that, in React's declaration-order effect flushing, the ref
  // is already up to date whenever a fetch cycle starts.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const [state, setState] = useState<CatalogByBackend<T>>({
    data: new Map(),
    errors: new Map(),
    loading: true,
  });

  const onlineKey = backends
    .filter(b => b.online)
    .map(b => b.backendId)
    .sort()
    .join(',');

  useEffect(() => {
    let cancelled = false;
    const onlineBackends = backends.filter(b => b.online);

    setState(prev => ({ ...prev, loading: true }));

    // The async wrapper converts a synchronous fetcher throw into a rejection
    // so it lands in the errors map instead of escaping the effect.
    void Promise.allSettled(onlineBackends.map(async b => fetcherRef.current(b.backendId))).then(
      results => {
        if (cancelled) return;

        const data = new Map<string, T>();
        const errors = new Map<string, string>();

        results.forEach((result, index) => {
          const backendId = onlineBackends[index].backendId;
          if (result.status === 'fulfilled') {
            data.set(backendId, result.value);
          } else {
            const error = result.reason;
            errors.set(backendId, error instanceof Error ? error.message : String(error));
          }
        });

        setState({ data, errors, loading: false });
      }
    );

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineKey, nonce]);

  return state;
}
