import { useCallback, useEffect, useRef } from 'react';
import { useComposerStore, type SessionDraft } from '../../../stores/composerStore';
import type { Attachment } from '../types';

const DRAFT_PERSIST_DEBOUNCE_MS = 300;

/**
 * Composer draft persistence: mirrors the in-progress message (text +
 * attachments) into the per-session composer store behind a short debounce so
 * switching sessions (or remounting the composer) restores what was typed.
 *
 * The pending value/attachments are kept in refs (not state) so persistence
 * never re-renders the composer; callers update them on every edit.
 */
export function useComposerDraft(sessionId: string) {
  const setDraft = useComposerStore(s => s.setDraft);
  const draftPersistTimeoutRef = useRef<number | null>(null);
  const pendingDraftValueRef = useRef('');
  const pendingDraftAttachmentsRef = useRef<Attachment[]>([]);

  const getPendingDraft = useCallback(
    (): SessionDraft => ({
      content: pendingDraftValueRef.current,
      attachments: pendingDraftAttachmentsRef.current,
    }),
    []
  );

  const flushDraftPersistence = useCallback(() => {
    if (draftPersistTimeoutRef.current) {
      clearTimeout(draftPersistTimeoutRef.current);
      draftPersistTimeoutRef.current = null;
    }

    setDraft(sessionId, getPendingDraft());
  }, [getPendingDraft, sessionId, setDraft]);

  const clearDraftPersistence = useCallback(() => {
    if (draftPersistTimeoutRef.current) {
      clearTimeout(draftPersistTimeoutRef.current);
      draftPersistTimeoutRef.current = null;
    }
    pendingDraftValueRef.current = '';
    pendingDraftAttachmentsRef.current = [];
  }, []);

  const scheduleDraftPersistence = useCallback(() => {
    if (draftPersistTimeoutRef.current) {
      clearTimeout(draftPersistTimeoutRef.current);
    }

    draftPersistTimeoutRef.current = window.setTimeout(() => {
      draftPersistTimeoutRef.current = null;
      setDraft(sessionId, getPendingDraft());
    }, DRAFT_PERSIST_DEBOUNCE_MS);
  }, [getPendingDraft, sessionId, setDraft]);

  // Flush any still-debounced draft update on unmount / session switch.
  useEffect(() => {
    return () => {
      if (draftPersistTimeoutRef.current) {
        flushDraftPersistence();
      }
    };
  }, [flushDraftPersistence]);

  return {
    pendingDraftValueRef,
    pendingDraftAttachmentsRef,
    flushDraftPersistence,
    clearDraftPersistence,
    scheduleDraftPersistence,
  };
}
