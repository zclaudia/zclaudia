import { useCallback, useEffect, useState } from 'react';
import { useComposerStore, type SessionDraft } from '../../../stores/composerStore';

/**
 * Composer prefill plumbing shared by the three composers that restore drafts
 * (ChatInterface, ChatInputArea, ClaudiaChat's keyed composer). The composer
 * store is the shared mechanism; the trigger semantics are deliberately NOT
 * merged — zero behavior change takes priority over deduplication:
 *
 * - ChatInterface latches a store snapshot per session switch
 *   (`useSessionInitialDraft`) so later store updates never reset what the
 *   user is typing.
 * - ChatInputArea consumes one-shot pushes (`useComposerPrefill`, e.g. the
 *   plan "Execute plan" button); they clear themselves on the next tick.
 * - ClaudiaChat captures once per keyed composer mount
 *   (`useComposerMountDraft`), letting a rejected run's draft take precedence.
 */

/**
 * One-shot pending prefill pushed into a composer from outside the chat
 * (e.g. "Execute plan", cross-surface drafts). The pending entry is consumed
 * (cleared) on the tick after it appears.
 */
export function useComposerPrefill(sessionId: string) {
  const pendingPrefill = useComposerStore(s => s.pendingPrefills[sessionId]);
  const clearPendingPrefill = useComposerStore(s => s.clearPendingPrefill);
  const setPendingPrefill = useComposerStore(s => s.setPendingPrefill);
  // `prefillConsumed` gates the fallback sources after consumption so the
  // user's in-progress edits stay put (otherwise initialValue would revert to
  // the draft and overwrite them on the next MessageInput effect).
  const [prefillConsumed, setPrefillConsumed] = useState(false);

  useEffect(() => {
    setPrefillConsumed(false);
  }, [sessionId]);

  useEffect(() => {
    if (!pendingPrefill) return;
    setPrefillConsumed(false);
    const timer = setTimeout(() => {
      clearPendingPrefill(sessionId);
      setPrefillConsumed(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [pendingPrefill, sessionId, clearPendingPrefill]);

  const pushPrefill = useCallback(
    (content: string) => setPendingPrefill(sessionId, content),
    [sessionId, setPendingPrefill]
  );

  return { pendingPrefill, prefillConsumed, pushPrefill };
}

/**
 * Latched per-session snapshot of the persisted draft (ChatInterface
 * semantics): recaptured once per session switch; store updates afterwards
 * never clobber it.
 */
export function useSessionInitialDraft(sessionId: string): SessionDraft | undefined {
  const [initialDraft, setInitialDraft] = useState<SessionDraft | undefined>(undefined);

  useEffect(() => {
    setInitialDraft(useComposerStore.getState().drafts[sessionId]);
  }, [sessionId]);

  return initialDraft;
}

/** Minimal structural view of a rejected run's draft payload. */
interface RejectedComposerDraft {
  input: string;
  draftRestored?: boolean;
  draftAttachments?: SessionDraft['attachments'];
}

/**
 * Capture a prefill once per keyed composer mount (ClaudiaChat semantics): a
 * rejected run's not-yet-restored draft wins over the persisted store draft.
 * Must run synchronously during the first render — the composer's initial
 * value has to exist at mount, not one effect later.
 */
export function useComposerMountDraft(
  sessionId: string,
  rejected?: RejectedComposerDraft | null
): SessionDraft | undefined {
  const [initialDraft] = useState(() =>
    rejected && !rejected.draftRestored
      ? { content: rejected.input, attachments: rejected.draftAttachments ?? [] }
      : useComposerStore.getState().drafts[sessionId]
  );
  return initialDraft;
}
