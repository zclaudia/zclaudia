import { useCallback, useEffect, useRef } from 'react';
import type { InvocableCatalogSnapshot, InvocableDescriptor } from '@zclaudia/shared/providers';
import { fetchApiForBackend } from '../../../services/api/base';
import {
  invocableCatalogKey,
  useInvocableCatalogStore,
} from '../../../stores/invocableCatalogStore';

/**
 * Session invocable catalog hook (URIP design doc §16).
 *
 * Fetches the session-scoped catalog from the backend that executes the
 * session's runs (never unconditionally the local backend), caches it under
 * the backend+session key, and exposes selection helpers. A catalog failure
 * never disables message submission: raw provider input remains available.
 */

interface UseInvocableCatalogOptions {
  backendId?: string | null;
  sessionId: string;
  /** Synthetic sessionless composers must not call the catalog API (§16.1). */
  enabled?: boolean;
  /** Public UI context whose change invalidates the session snapshot (for example cwd). */
  contextToken?: string;
}

export function useInvocableCatalog({
  backendId,
  sessionId,
  enabled = true,
  contextToken = '',
}: UseInvocableCatalogOptions) {
  const store = useInvocableCatalogStore();
  const key = invocableCatalogKey(backendId, sessionId);
  const entry = store.entries.get(key);
  const snapshot = entry?.snapshot;
  const previousContextToken = useRef(contextToken);

  const fetchCatalog = useCallback(async () => {
    const { setEntry } = useInvocableCatalogStore.getState();
    if (!sessionId || sessionId === 'claudia-input') return;
    setEntry(key, {
      ...(useInvocableCatalogStore.getState().entries.get(key) ?? {}),
      loading: true,
    } as never);
    try {
      const response = await fetchApiForBackend<{ data: InvocableCatalogSnapshot }>(
        `/api/sessions/${encodeURIComponent(sessionId)}/invocables`,
        backendId
      );
      if (!response.success) {
        setEntry(key, {
          loading: false,
          waitingForLiveCatalog: false,
          error: response.error?.message ?? 'Catalog unavailable',
        });
        return;
      }
      const snapshot = (response as unknown as { data: InvocableCatalogSnapshot }).data;
      setEntry(key, {
        snapshot,
        loading: false,
        waitingForLiveCatalog: snapshot.phase === 'bootstrap' || snapshot.phase === 'initializing',
      });
    } catch (error) {
      setEntry(key, {
        loading: false,
        waitingForLiveCatalog: false,
        error: error instanceof Error ? error.message : 'Catalog unavailable',
      });
    }
  }, [backendId, key, sessionId]);

  useEffect(() => {
    if (!enabled || !sessionId || sessionId === 'claudia-input') return;
    if (!entry?.snapshot && !entry?.loading && !entry?.error) {
      void fetchCatalog();
    }
  }, [enabled, entry?.error, entry?.loading, entry?.snapshot, fetchCatalog, sessionId]);

  useEffect(() => {
    if (previousContextToken.current === contextToken) return;
    previousContextToken.current = contextToken;
    useInvocableCatalogStore.getState().removeEntry(key);
    if (enabled && sessionId && sessionId !== 'claudia-input') void fetchCatalog();
  }, [contextToken, enabled, fetchCatalog, key, sessionId]);

  /** Filter rows for the composer: match a `/trigger` prefix being typed. */
  const autocomplete = useCallback(
    (typed: string): InvocableDescriptor[] => {
      if (!snapshot || !typed.startsWith('/')) return [];
      const query = typed.slice(1).toLowerCase();
      return snapshot.invocables.filter(
        item =>
          item.availability.available &&
          (item.displayTrigger.slice(1).toLowerCase().startsWith(query) ||
            item.aliases?.some(alias => alias.toLowerCase().startsWith(query)))
      );
    },
    [snapshot]
  );

  return {
    snapshot,
    loading: entry?.loading ?? false,
    waitingForLiveCatalog: entry?.waitingForLiveCatalog ?? false,
    error: entry?.error,
    reload: fetchCatalog,
    autocomplete,
    version: store.version,
  };
}
