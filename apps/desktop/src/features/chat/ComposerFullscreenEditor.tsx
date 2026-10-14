import { useEffect, useRef } from 'react';
import { ArrowUp, Minimize2 } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { AttachmentPreviewList } from './AttachmentPreviewList';
import type { Attachment } from './types';

interface ComposerFullscreenEditorProps {
  open: boolean;
  /** Collapse back to the inline composer; the draft is kept. */
  onCollapse: () => void;
  value: string;
  onChange: (value: string) => void;
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  onSend: () => void;
  canSend: boolean;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Mobile full-screen editor for long drafts. It edits the composer's own
 * draft and attachments (no copy), so collapsing, sending, or closing with
 * Android back leaves the inline composer in sync.
 */
export function ComposerFullscreenEditor({
  open,
  onCollapse,
  value,
  onChange,
  attachments,
  onRemoveAttachment,
  onSend,
  canSend,
  disabled = false,
  placeholder,
}: ComposerFullscreenEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Modal focuses its card on open; take focus after it, caret at the end.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onCollapse}
      ariaLabel="Edit message"
      mobileFullscreen
      isMobile
      bodyScrollable={false}
    >
      <div className="flex h-full flex-col">
        <div className="flex h-14 flex-shrink-0 items-center gap-1 px-1.5">
          <button
            type="button"
            onClick={onCollapse}
            className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            title="Collapse"
            aria-label="Collapse editor"
          >
            <Minimize2 size={18} strokeWidth={1.75} />
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            className="mr-1 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            title="Send message"
            aria-label="Send message"
          >
            <ArrowUp size={21} strokeWidth={2.25} />
          </button>
        </div>
        <AttachmentPreviewList
          attachments={attachments}
          onRemove={onRemoveAttachment}
          className="flex flex-shrink-0 gap-2 overflow-x-auto px-4 pt-1 pb-2"
        />
        <textarea
          ref={textareaRef}
          aria-label="Message"
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          className="min-h-0 w-full flex-1 resize-none border-0 bg-transparent px-4 pb-4 leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          style={{ fontSize: 'var(--chat-font-input, 0.8125rem)' }}
        />
      </div>
    </Modal>
  );
}
