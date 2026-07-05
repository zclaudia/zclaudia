/**
 * Just-saved bridge for the Agents shell mode detail pane.
 *
 * After a save the parent re-selects the saved id and bumps agentsRefreshNonce,
 * but the catalog refetch hasn't landed yet — the fetched map is briefly stale.
 * The bridge remembers what was just saved so the detail pane can keep its
 * chrome (or the full editor, when the save handler had the object) instead of
 * flashing the empty state during that gap.
 *
 * Lifecycle (nonce-tracked hardening): the record remembers the refresh nonce
 * at save time and clears when either
 *  - the fetched data contains the saved id (the fetch is now authoritative), or
 *  - a fetch cycle at nonce >= nonceAtSave SETTLES without it: `loading` was
 *    observed true after the record was created (nonce bumps BEFORE loading
 *    flips true, so any post-record loading phase is at nonce >= nonceAtSave)
 *    and then flipped back to false. The guarantee that `loading` only settles
 *    for the latest cycle comes from useCatalogByBackend's own per-effect
 *    `cancelled` flag, which drops a superseded cycle's setState entirely; the
 *    nonce >= nonceAtSave check here is belt-and-braces on top of that.
 *
 * The settle clause fixes two edges the old selection-scoped overlay/marker had:
 * a refetch that settles WITHOUT the id no longer leaves an eternal Loading
 * body, and a post-save fetch error is no longer masked by Loading chrome —
 * once the record clears, the consumer's normal stale/error branches take over.
 *
 * The bridge is selection-agnostic: it never inspects the current selection,
 * so a lookup for a different identity simply misses. Consumers can call
 * `clear()` explicitly for selection-move cases if they want to drop the
 * record early.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';

export interface SavedBridge<T> {
  /** Call in onSaved: remember what was saved (full object when available, id-only otherwise). */
  record: (backendId: string, id: string, value?: T) => void;
  /** Resolve the bridge for a selection identity: full value (profiles) or true (id-only marker). */
  lookup: (backendId: string, id: string) => T | true | undefined;
  clear: () => void;
}

interface SavedRecord<T> {
  backendId: string;
  id: string;
  value: T | undefined;
  nonceAtSave: number;
}

export function useSavedBridge<T>(opts: {
  /** Current loading flag of the relevant catalog. */
  loading: boolean;
  /** Returns true when the fetched data now contains the id (authoritative). */
  contains: (backendId: string, id: string) => boolean;
}): SavedBridge<T> {
  const { loading, contains } = opts;
  const nonce = useTopLevelViewStore(s => s.agentsRefreshNonce);

  const [saved, setSaved] = useState<SavedRecord<T> | null>(null);

  // True once a loading phase at nonce >= nonceAtSave has been observed AFTER
  // the record was created — the next loading=false is then a settle. Starting
  // false is what prevents clearing in the render the save happened in (loading
  // is still false there; the refetch hasn't started yet).
  const sawRefetchRef = useRef(false);

  const record = useCallback((backendId: string, id: string, value?: T) => {
    sawRefetchRef.current = false;
    setSaved({
      backendId,
      id,
      value,
      // Read at call time (not the subscribed value): the consumer typically
      // records and bumps in the same handler, and the subscribed value could
      // lag the store by a render.
      nonceAtSave: useTopLevelViewStore.getState().agentsRefreshNonce,
    });
  }, []);

  const clear = useCallback(() => {
    setSaved(null);
  }, []);

  // Deliberately re-runs every render when `contains` is an inline closure —
  // the body is idempotent, and fresh closures are exactly what keeps the
  // containment check reading the latest fetched data.
  useEffect(() => {
    if (!saved) return;

    if (contains(saved.backendId, saved.id)) {
      // Fetched data is now authoritative.
      setSaved(null);
      return;
    }

    if (loading && nonce >= saved.nonceAtSave) {
      sawRefetchRef.current = true;
      return;
    }

    if (!loading && sawRefetchRef.current && nonce >= saved.nonceAtSave) {
      // A cycle at nonce >= nonceAtSave settled without the id: the data is as
      // fresh as it gets — stop bridging and let the consumer's stale/error
      // rendering take over.
      setSaved(null);
    }
  }, [saved, loading, nonce, contains]);

  const lookup = useCallback(
    (backendId: string, id: string): T | true | undefined => {
      if (!saved || saved.backendId !== backendId || saved.id !== id) return undefined;
      return saved.value !== undefined ? saved.value : true;
    },
    [saved]
  );

  return { record, lookup, clear };
}
