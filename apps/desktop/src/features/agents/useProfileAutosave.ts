import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveStatus = 'saved' | 'saving' | 'pending' | 'failed';

export interface UseProfileAutosaveParams {
  /** True only when editing an existing profile; create mode passes false. */
  enabled: boolean;
  /** Whole-form validity gate; while false, changes are held (not persisted). */
  valid: boolean;
  /** Serialized payload — a change here schedules a save. */
  signature: string;
  /** Performs the persist (build payload + call api + notify parent). */
  save: () => Promise<void>;
  debounceMs?: number;
}

export interface UseProfileAutosaveResult {
  status: SaveStatus;
  /** Persist now if dirty+valid+enabled (e.g. on blur). */
  flush: () => void;
  /** Re-attempt after a failure (gated on enabled+valid). */
  retry: () => void;
}

export function useProfileAutosave({
  enabled,
  valid,
  signature,
  save,
  debounceMs = 600,
}: UseProfileAutosaveParams): UseProfileAutosaveResult {
  const [status, setStatus] = useState<SaveStatus>('saved');
  const lastSaved = useRef(signature); // signature known to be persisted
  const sigRef = useRef(signature);
  const saveRef = useRef(save);
  const enabledRef = useRef(enabled);
  const validRef = useRef(valid);
  const savingRef = useRef(false);
  const prevEnabledRef = useRef(enabled);
  const mountedRef = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  sigRef.current = signature;
  saveRef.current = save;
  enabledRef.current = enabled;
  validRef.current = valid;

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  // Stable: reads live values from refs so the debounce effect need not depend
  // on the (often inline) `save` closure.
  const runSave = useCallback(async () => {
    if (savingRef.current) return;
    if (sigRef.current === lastSaved.current) {
      // Nothing new to persist and no save in flight. Never leave a stale
      // "saving" spinner up: this fires when a scheduled/trailing run finds the
      // current signature already saved (e.g. the signature blipped and settled
      // back to the persisted value while a save was completing).
      if (mountedRef.current) setStatus(s => (s === 'saving' ? 'saved' : s));
      return;
    }
    const saving = sigRef.current;
    savingRef.current = true;
    if (mountedRef.current) setStatus('saving');
    try {
      await saveRef.current();
      lastSaved.current = saving;
      if (!mountedRef.current) return;
      if (sigRef.current === lastSaved.current) {
        setStatus('saved');
      } else {
        // Edits arrived during the save — persist the trailing change.
        setStatus('saving');
        clearTimer();
        timer.current = setTimeout(() => void runSave(), 0);
      }
    } catch {
      if (mountedRef.current) setStatus('failed');
    } finally {
      savingRef.current = false;
    }
  }, []);

  // Safety net: the spinner must never outlive the work. If a render settles
  // with no save in flight and the current signature already persisted, the
  // status can only legitimately be "saved" — converge there. Guards against
  // timing/batching races (e.g. a prop blip around a completing save) that
  // could otherwise strand the indicator on "saving".
  useEffect(() => {
    if (status === 'saving' && !savingRef.current && sigRef.current === lastSaved.current) {
      setStatus('saved');
    }
  });

  useEffect(() => {
    const justEnabled = enabled && !prevEnabledRef.current;
    prevEnabledRef.current = enabled;
    if (!enabled) return;
    if (justEnabled) {
      // Autosave just turned on because the editor finished hydrating its form
      // from the loaded record (form populated + enabled in the same commit).
      // Adopt the hydrated signature as the saved baseline so opening a record
      // is never mistaken for a user edit and never schedules a phantom save.
      lastSaved.current = signature;
      clearTimer();
      setStatus('saved');
      return;
    }
    if (signature === lastSaved.current) {
      setStatus(s => (s === 'failed' ? s : 'saved'));
      return;
    }
    if (!valid) {
      clearTimer();
      setStatus('pending');
      return;
    }
    setStatus('saving');
    clearTimer();
    timer.current = setTimeout(() => void runSave(), debounceMs);
    return clearTimer;
  }, [signature, enabled, valid, debounceMs, runSave]);

  const flush = useCallback(() => {
    if (!enabledRef.current || !validRef.current) return;
    clearTimer();
    void runSave();
  }, [runSave]);

  const retry = useCallback(() => {
    if (!enabledRef.current || !validRef.current) return;
    clearTimer();
    void runSave();
  }, [runSave]);

  return { status, flush, retry };
}
