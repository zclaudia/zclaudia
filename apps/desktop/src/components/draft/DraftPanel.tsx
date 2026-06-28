import { useCallback, useRef, useEffect } from 'react';
import { useDraftEditorStore } from '../../stores/draftEditorStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { MAX_CONTENT_BYTES } from './draftConstants';

/** Draft panel content rendered inside BottomPanel. Controls live in DraftActions (header). */
export function DraftPanel() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    localContent,
    isReadOnly,
    activeSessionId,
    sessionArchived,
    setLocalContent,
    finishDraft,
  } = useDraftEditorStore();

  const selectedSessionId = useSelectionStore((s) => s.selectedSessionId);
  const sessionMatches = !!activeSessionId && (!selectedSessionId || activeSessionId === selectedSessionId);

  // Self-initialize: bind the editor to the selected session (workspace launcher
  // opens this panel without calling openEditor). Also re-converges on switch.
  useEffect(() => {
    if (selectedSessionId && activeSessionId !== selectedSessionId) {
      void useDraftEditorStore.getState().openEditor(selectedSessionId);
    }
  }, [selectedSessionId, activeSessionId]);

  const effectiveReadOnly = isReadOnly || sessionArchived;

  // Auto-focus when shown
  useEffect(() => {
    if (textareaRef.current && !effectiveReadOnly && sessionMatches) {
      textareaRef.current.focus();
    }
  }, [activeSessionId, effectiveReadOnly, sessionMatches]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      if (new TextEncoder().encode(value).length > MAX_CONTENT_BYTES) return;
      setLocalContent(value);
    },
    [setLocalContent]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (effectiveReadOnly) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        const { sendCallback, localContent: content } = useDraftEditorStore.getState();
        if (sendCallback && content.trim()) void finishDraft(sendCallback);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const el = e.currentTarget;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const next = el.value.slice(0, start) + '  ' + el.value.slice(end);
        setLocalContent(next);
        requestAnimationFrame(() => {
          el.selectionStart = el.selectionEnd = start + 2;
        });
      }
    },
    [finishDraft, setLocalContent, effectiveReadOnly]
  );

  if (!sessionMatches) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading draft...
      </div>
    );
  }

  const showEmptyHint = localContent.length === 0 && !effectiveReadOnly;

  return (
    <div className="flex flex-col h-full">
      {sessionArchived && (
        <div className="px-3 py-1.5 bg-yellow-500/10 text-yellow-500 text-xs border-b border-border flex-shrink-0">
          Session has been archived. Draft is read-only.
        </div>
      )}

      <div className="relative flex-1 overflow-hidden flex justify-center">
        <textarea
          ref={textareaRef}
          value={localContent}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          readOnly={effectiveReadOnly}
          className={`w-full h-full max-w-[680px] resize-none bg-transparent px-4 py-5 text-sm leading-relaxed text-foreground focus:outline-none ${
            effectiveReadOnly ? 'opacity-60 cursor-default' : ''
          }`}
          placeholder=""
          aria-label="Draft message"
          spellCheck={!effectiveReadOnly}
        />
        {showEmptyHint && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="max-w-xs text-sm text-muted-foreground">
              This draft auto-saves and syncs across your devices — come back anytime.
            </p>
            <p className="text-xs text-muted-foreground">
              Press <kbd className="rounded border border-border px-1.5 py-0.5">⌘↵</kbd> to send to chat
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
