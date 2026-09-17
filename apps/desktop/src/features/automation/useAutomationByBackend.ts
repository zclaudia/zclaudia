import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFacadeStore } from '../../stores/facadeStore';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';
import { selectAgentsBackends } from '../agents/selectAgentsBackends';
import { createAutomationApi, type AutomationApi } from './useAutomationApi';
import type { AutomationBackend } from './automation-types';

/**
 * Backends the automation tabs fan out over: the same ordering the Agents
 * shell uses (local first, then by name), offline ones kept so the filter
 * chips can show them dimmed.
 */
export function useAutomationBackends(): AutomationBackend[] {
  const backends = useFacadeStore(s => s.backends);
  const localBackendId = useFacadeStore(s => s.localBackendId);
  return useMemo(() => selectAgentsBackends(backends, localBackendId), [backends, localBackendId]);
}

/** The backends a tab actually renders for the current filter (online only). */
export function scopedBackends(
  backends: AutomationBackend[],
  backendFilter: 'all' | string
): AutomationBackend[] {
  const online = backends.filter(b => b.online);
  if (backendFilter === 'all') return online;
  return online.filter(b => b.backendId === backendFilter);
}

/** Whether rows should sit under per-backend group headers. */
export function isGroupedByBackend(
  backends: AutomationBackend[],
  backendFilter: 'all' | string
): boolean {
  return backendFilter === 'all' && backends.filter(b => b.online).length > 1;
}

export interface ByBackend<T> {
  data: Map<string, T>;
  errors: Map<string, string>;
  loading: boolean;
  /** Refetch every backend. */
  refresh: () => void;
}

/**
 * Per-backend fetcher for the automation tabs (the Agents shell's
 * `useCatalogByBackend`, keyed on the automation refresh nonce and with a
 * local refresh). Fetches `fetcher(api, backendId)` for each backend in
 * `backends`, isolates failures per backend, and guards stale writes.
 *
 * `fetcher` need not be stable: the latest one is kept in a ref and the effect
 * is keyed on the backend id set, the store nonce, and the local nonce only.
 */
export function useAutomationByBackend<T>(
  backends: AutomationBackend[],
  fetcher: (api: AutomationApi, backendId: string) => Promise<T>
): ByBackend<T> {
  const storeNonce = useTopLevelViewStore(s => s.automationListRefreshNonce);
  const [localNonce, setLocalNonce] = useState(0);

  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const [state, setState] = useState<{
    data: Map<string, T>;
    errors: Map<string, string>;
    loading: boolean;
  }>({ data: new Map(), errors: new Map(), loading: backends.length > 0 });

  const idsKey = backends
    .map(b => b.backendId)
    .sort()
    .join(',');

  useEffect(() => {
    let cancelled = false;
    const ids = idsKey ? idsKey.split(',') : [];
    if (ids.length === 0) {
      setState({ data: new Map(), errors: new Map(), loading: false });
      return;
    }
    setState(prev => ({ ...prev, loading: true }));

    void Promise.allSettled(
      ids.map(async id => fetcherRef.current(createAutomationApi(id), id))
    ).then(results => {
      if (cancelled) return;
      const data = new Map<string, T>();
      const errors = new Map<string, string>();
      results.forEach((result, index) => {
        const id = ids[index];
        if (result.status === 'fulfilled') data.set(id, result.value);
        else {
          const reason = result.reason;
          errors.set(id, reason instanceof Error ? reason.message : String(reason));
        }
      });
      setState({ data, errors, loading: false });
    });

    return () => {
      cancelled = true;
    };
  }, [idsKey, storeNonce, localNonce]);

  const refresh = useCallback(() => setLocalNonce(n => n + 1), []);

  return useMemo(() => ({ ...state, refresh }), [state, refresh]);
}
