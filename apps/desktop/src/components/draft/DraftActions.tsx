import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Send, Trash2, ExternalLink } from 'lucide-react';
import { useDraftEditorStore } from '../../stores/draftEditorStore';
import { isDesktopTauri } from '../../utils/platform';
import { openDraftInNewWindow } from '../../actions/openDraftWindow';
import { MAX_CONTENT_BYTES } from './draftConstants';
import { useWorkspaceTool } from '../workspace/WorkspaceToolContext';

const ICON_BTN =
  'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors flex-shrink-0';

/** Draft toolbar actions rendered in the shared BottomPanel header (top-right). */
export function DraftActions() {
  const activeSessionId = useDraftEditorStore(s => s.activeSessionId);
  const boundSessionId = useWorkspaceTool()?.sessionId;
  return <DraftActionControls key={JSON.stringify([activeSessionId, boundSessionId])} />;
}

function DraftActionControls() {
  const tool = useWorkspaceTool();
  const boundSessionId = tool?.sessionId;
  const {
    localContent,
    isSaving,
    lastSavedAt,
    isReadOnly,
    sessionArchived,
    activeSessionId,
    poppedOut,
    sendCallback,
    finishDraft,
    discardDraft,
  } = useDraftEditorStore();

  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionMatches = tool ? !!boundSessionId && boundSessionId === activeSessionId : true;

  useEffect(
    () => () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    },
    []
  );

  const effectiveReadOnly = isReadOnly || sessionArchived;
  const hasContent = !!localContent.trim();
  const charCount = localContent.length;
  const byteSize = useMemo(() => new TextEncoder().encode(localContent).length, [localContent]);
  const sizePercent = Math.round((byteSize / MAX_CONTENT_BYTES) * 100);

  let statusText = '';
  if (isSaving) statusText = 'Saving…';
  else if (lastSavedAt) statusText = 'Saved';

  const handleSend = useCallback(() => {
    const draft = useDraftEditorStore.getState();
    if (
      draft.activeSessionId !== activeSessionId ||
      (tool && (!boundSessionId || draft.activeSessionId !== boundSessionId))
    )
      return;
    const cb = draft.sendCallback;
    if (cb) void finishDraft(cb);
  }, [finishDraft, activeSessionId, boundSessionId, tool]);

  const handleDiscard = useCallback(() => {
    const draftSessionId = useDraftEditorStore.getState().activeSessionId;
    if (
      draftSessionId !== activeSessionId ||
      (tool && (!boundSessionId || draftSessionId !== boundSessionId))
    )
      return;
    if (!confirmingDiscard) {
      setConfirmingDiscard(true);
      confirmTimer.current = setTimeout(() => setConfirmingDiscard(false), 3000);
      return;
    }
    setConfirmingDiscard(false);
    void discardDraft();
  }, [confirmingDiscard, discardDraft, activeSessionId, boundSessionId, tool]);

  const handlePopOut = useCallback(async () => {
    if (
      !activeSessionId ||
      useDraftEditorStore.getState().activeSessionId !== activeSessionId ||
      (tool && (!boundSessionId || activeSessionId !== boundSessionId))
    )
      return;
    const label = await openDraftInNewWindow(activeSessionId);
    if (useDraftEditorStore.getState().activeSessionId !== activeSessionId) return;
    useDraftEditorStore.getState().setPoppedOut(true, label);
  }, [activeSessionId, boundSessionId, tool]);

  if (!sessionMatches) return null;

  return (
    <div className="flex items-center gap-1">
      <span className="mr-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        {statusText && (
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${isSaving ? 'bg-muted-foreground' : 'bg-green-500'}`}
            aria-hidden="true"
          />
        )}
        {statusText && <span>{statusText} &middot;</span>}
        <span>
          {charCount} chars
          {sizePercent > 80 && (
            <span className={sizePercent > 95 ? 'text-red-500' : 'text-yellow-500'}>
              {' '}
              ({sizePercent}%)
            </span>
          )}
        </span>
        {isReadOnly && !sessionArchived && (
          <span className="rounded-md bg-yellow-500/10 px-1.5 py-0.5 text-[11px] text-yellow-500">
            Read Only
          </span>
        )}
      </span>

      {!effectiveReadOnly && (
        <button
          onClick={handleSend}
          disabled={!hasContent || !sendCallback}
          className={`${ICON_BTN} bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed`}
          title="Send to chat (⌘↩)"
          aria-label="Send to chat"
        >
          <Send className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}

      <button
        onClick={handleDiscard}
        disabled={effectiveReadOnly}
        className={`${ICON_BTN} disabled:opacity-40 ${
          confirmingDiscard
            ? 'text-red-500 bg-red-500/10'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
        }`}
        title={confirmingDiscard ? 'Click again to discard' : 'Discard draft'}
        aria-label={confirmingDiscard ? 'Confirm discard draft' : 'Discard draft'}
      >
        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
      </button>

      {isDesktopTauri() && activeSessionId && !poppedOut && (
        <button
          onClick={handlePopOut}
          className={`${ICON_BTN} text-muted-foreground hover:bg-secondary hover:text-foreground`}
          title="Open in new window"
          aria-label="Open draft in new window"
        >
          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
