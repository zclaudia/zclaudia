import { useCallback, useRef } from 'react';

const DUPLICATE_SEND_GUARD_MS = 400;

/**
 * Guards the composer against duplicate submissions — mobile double-taps and
 * synthetic click re-entry can both re-trigger send before React clears the
 * local input state. A submission with the same key (text + attachment ids)
 * inside the guard window is dropped.
 */
export function useDuplicateSendGuard() {
  const lastSubmissionRef = useRef<{ key: string; at: number } | null>(null);

  /** True when `key` matches the previous submission inside the guard window. */
  const isDuplicateSubmission = useCallback((key: string) => {
    const lastSubmission = lastSubmissionRef.current;
    return (
      !!lastSubmission &&
      lastSubmission.key === key &&
      Date.now() - lastSubmission.at < DUPLICATE_SEND_GUARD_MS
    );
  }, []);

  const recordSubmission = useCallback((key: string) => {
    lastSubmissionRef.current = { key, at: Date.now() };
  }, []);

  /** Clears the last submission (e.g. a send attempt that was rejected). */
  const clearSubmission = useCallback(() => {
    lastSubmissionRef.current = null;
  }, []);

  return { isDuplicateSubmission, recordSubmission, clearSubmission };
}
