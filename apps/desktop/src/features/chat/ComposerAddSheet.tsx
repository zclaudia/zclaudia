import type { ReactNode } from 'react';
import { Image as ImageIcon, Paperclip } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { SECTION_LABEL } from '../../components/ui/typography';

/** One launcher row in the sheet's Tools section (draft, files, terminal…). */
export interface ComposerToolItem {
  key: string;
  icon: ReactNode;
  label: string;
  isActive: boolean;
  hasBadge?: boolean;
  onClick: () => void;
}

interface ComposerAddSheetProps {
  open: boolean;
  onClose: () => void;
  onPickPhotos: () => void;
  onPickFiles: () => void;
  /** Type a `/` or `@` trigger into the composer and focus it. */
  onInsert: (trigger: '/' | '@') => void;
  /** `@` file references need a project root. */
  canMention: boolean;
  /** Composer disabled (disconnected): attach and insert are unavailable. */
  disabled?: boolean;
  tools: ComposerToolItem[];
  /** Low-frequency session controls (worktree) shown at the bottom. */
  sessionRows?: ReactNode;
}

const ROW_CLASS =
  'flex h-12 w-full items-center gap-3.5 rounded-lg px-1 text-left text-[15px] transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Mobile composer "+" sheet: everything that used to crowd the composer —
 * attachments, the `/` and `@` triggers (awkward to type on a phone keyboard),
 * the tool panels, and the worktree picker.
 */
export function ComposerAddSheet({
  open,
  onClose,
  onPickPhotos,
  onPickFiles,
  onInsert,
  canMention,
  disabled = false,
  tools,
  sessionRows,
}: ComposerAddSheetProps) {
  // Close first, then act: file pickers must open inside the same tap gesture,
  // and an inserted trigger should land in a focused composer, not the sheet.
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel="Add to message"
      placement="bottom"
      isMobile
      maxHeightClassName="max-h-[85vh]"
    >
      <div className="flex flex-col gap-3 px-4 pt-2 pb-3">
        <div className="mx-auto h-1.5 w-9 rounded-full bg-border" aria-hidden />

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={run(onPickPhotos)}
            disabled={disabled}
            className="flex h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-secondary text-[13px] text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ImageIcon size={22} strokeWidth={1.75} />
            Photos
          </button>
          <button
            type="button"
            onClick={run(onPickFiles)}
            disabled={disabled}
            className="flex h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-secondary text-[13px] text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Paperclip size={22} strokeWidth={1.75} />
            Files
          </button>
        </div>

        <div className="flex flex-col">
          <div className={`${SECTION_LABEL} px-1 pb-1`}>Insert</div>
          <button
            type="button"
            onClick={run(() => onInsert('/'))}
            disabled={disabled}
            className={ROW_CLASS}
          >
            <span className="w-5 text-center text-[17px] text-muted-foreground">/</span>
            <span className="flex-1">Command or skill</span>
          </button>
          {canMention && (
            <button
              type="button"
              onClick={run(() => onInsert('@'))}
              disabled={disabled}
              className={ROW_CLASS}
            >
              <span className="w-5 text-center text-base text-muted-foreground">@</span>
              <span className="flex-1">Reference a file</span>
            </button>
          )}
        </div>

        {tools.length > 0 && (
          <div className="flex flex-col">
            <div className={`${SECTION_LABEL} px-1 pb-1`}>Tools</div>
            {tools.map(item => (
              <button
                key={item.key}
                type="button"
                onClick={run(item.onClick)}
                className={`${ROW_CLASS} ${item.isActive ? 'text-primary' : 'text-foreground'}`}
              >
                <span
                  className={`relative flex w-5 justify-center ${item.isActive ? '' : 'text-muted-foreground'}`}
                >
                  {item.icon}
                  {item.hasBadge && (
                    <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </button>
            ))}
          </div>
        )}

        {sessionRows && <div className="border-t border-border pt-1.5">{sessionRows}</div>}
      </div>
    </Modal>
  );
}
