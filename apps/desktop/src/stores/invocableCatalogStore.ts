import { create } from 'zustand';
import type { InvocableCatalogSnapshot } from '@zclaudia/shared/providers';

/**
 * Session invocable catalog store (URIP design doc §16.1).
 *
 * Replaces provider-type command caches: state is keyed by backend AND
 * session, because a changed runtime, engine mode, cwd, or server-provided
 * revision changes the catalog. The snapshot is always fetched from the
 * backend that will execute the session's runs — never the local backend for
 * a remote/gateway session.
 */

export interface SessionInvocableState {
  snapshot?: InvocableCatalogSnapshot;
  loading: boolean;
  /** True when the runtime portion is expected to be replaced after init. */
  waitingForLiveCatalog: boolean;
  error?: string;
}

interface InvocableCatalogState {
  readonly entries: Map<string, SessionInvocableState>;
  /** Version bump that triggers subscribers after Map mutations. */
  version: number;
  setEntry: (key: string, entry: SessionInvocableState) => void;
  removeEntry: (key: string) => void;
}

export const useInvocableCatalogStore = create<InvocableCatalogState>(set => ({
  entries: new Map(),
  version: 0,
  setEntry: (key, entry) =>
    set(state => {
      const entries = new Map(state.entries);
      entries.set(key, entry);
      return { entries, version: state.version + 1 };
    }),
  removeEntry: key =>
    set(state => {
      if (!state.entries.has(key)) return state;
      const entries = new Map(state.entries);
      entries.delete(key);
      return { entries, version: state.version + 1 };
    }),
}));

/** Catalog cache key: backend AND session (§16.1) — never provider type. */
export function invocableCatalogKey(
  backendId: string | null | undefined,
  sessionId: string
): string {
  return `${backendId ?? 'local'}\u0000${sessionId}`;
}

export function getInvocableCatalogState(
  backendId: string | null | undefined,
  sessionId: string
): SessionInvocableState | undefined {
  return useInvocableCatalogStore.getState().entries.get(invocableCatalogKey(backendId, sessionId));
}
