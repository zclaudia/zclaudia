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
  /** Re-attempt after a failure. */
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
  const savingRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  sigRef.current = signature;

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const runSave = useCallback(async () => {
    if (savingRef.current) return;
    if (sigRef.current === lastSaved.current) return;
    const saving = sigRef.current;
    savingRef.current = true;
    setStatus('saving');
    try {
      await save();
      lastSaved.current = saving;
      if (sigRef.current === lastSaved.current) {
        setStatus('saved');
      } else {
        // Edits arrived during the save — persist the trailing change.
        setStatus('saving');
        clearTimer();
        timer.current = setTimeout(() => void runSave(), 0);
      }
    } catch {
      setStatus('failed');
    } finally {
      savingRef.current = false;
    }
  }, [save]);

  useEffect(() => {
    if (!enabled) return;
    if (signature === lastSaved.current) {
      // Unchanged (or just-saved) — don't clobber a failure state.
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
    if (!enabled || !valid) return;
    clearTimer();
    void runSave();
  }, [enabled, valid, runSave]);

  const retry = useCallback(() => {
    clearTimer();
    void runSave();
  }, [runSave]);

  return { status, flush, retry };
}
