import { useState } from 'react';
import { ArrowLeft, MoreHorizontal, Trash2 } from 'lucide-react';
import { Badge } from './Badge';
import type { DetailBadge } from './DetailHeader';
import { SaveStateIndicator } from './SaveStateIndicator';
import type { SaveStatus } from '../useProfileAutosave';

export interface ProfileHeaderProps {
  crumb: string;
  onBack: () => void;
  name: string;
  onNameChange: (v: string) => void;
  onFieldBlur?: () => void;
  namePlaceholder: string;
  description: string;
  onDescriptionChange: (v: string) => void;
  badges?: DetailBadge[];
  saveStatus?: SaveStatus;
  onRetry?: () => void;
  onRequestDelete?: () => void;
  deleting?: boolean;
  /** When true, name/description inputs are disabled (read-only profile). */
  disabled?: boolean;
}

export function ProfileHeader({
  crumb,
  onBack,
  name,
  onNameChange,
  onFieldBlur,
  namePlaceholder,
  description,
  onDescriptionChange,
  badges = [],
  saveStatus,
  onRetry,
  onRequestDelete,
  deleting,
  disabled,
}: ProfileHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="border-b border-border px-4 py-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex flex-shrink-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} /> {crumb}
        </button>
        <span className="flex-shrink-0 text-sm text-muted-foreground/50">/</span>
        <input
          type="text"
          value={name}
          onChange={e => onNameChange(e.target.value)}
          onBlur={onFieldBlur}
          placeholder={namePlaceholder}
          aria-label="Profile name"
          size={1}
          disabled={disabled}
          className="w-auto min-w-[3rem] max-w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-foreground [field-sizing:content] hover:border-border focus:border-border focus:bg-background/60 focus:outline-none disabled:cursor-default disabled:opacity-70"
        />
        {(badges.length > 0 || saveStatus || onRequestDelete) && (
          <div className="ml-auto flex flex-shrink-0 items-center gap-2 pl-2">
            {badges.map(b => (
              <Badge key={b.label} label={b.label} tone={b.tone} online={b.online} />
            ))}
            {saveStatus && <SaveStateIndicator status={saveStatus} onRetry={onRetry} />}
            {onRequestDelete && (
              <div className="relative">
                <button
                  type="button"
                  aria-label="More actions"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen(o => !o)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <MoreHorizontal size={16} strokeWidth={1.75} />
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-[70]" onClick={() => setMenuOpen(false)} />
                    <div
                      role="menu"
                      className="absolute right-0 top-full z-[80] mt-1 min-w-44 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-md"
                    >
                      <button
                        role="menuitem"
                        type="button"
                        disabled={deleting}
                        onClick={() => {
                          setMenuOpen(false);
                          onRequestDelete();
                        }}
                        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50 disabled:pointer-events-none"
                      >
                        <Trash2 size={14} strokeWidth={1.75} />
                        Delete profile
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <input
        type="text"
        value={description}
        onChange={e => onDescriptionChange(e.target.value)}
        onBlur={onFieldBlur}
        placeholder="Add a description"
        aria-label="Profile description"
        size={1}
        disabled={disabled}
        className="mt-1 block w-auto min-w-[3rem] max-w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs text-muted-foreground [field-sizing:content] hover:border-border focus:border-border focus:bg-background/60 focus:outline-none disabled:cursor-default disabled:opacity-70"
      />
    </div>
  );
}
