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
}: ProfileHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="border-b border-border px-4 py-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} /> {crumb}
        </button>
        <span className="text-muted-foreground">/</span>
        <input
          type="text"
          value={name}
          onChange={e => onNameChange(e.target.value)}
          onBlur={onFieldBlur}
          placeholder={namePlaceholder}
          aria-label="Profile name"
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-foreground hover:border-border focus:border-border focus:bg-background/60 focus:outline-none"
        />
        {badges.map(b => (
          <Badge key={b.label} label={b.label} tone={b.tone} online={b.online} />
        ))}
        {(saveStatus || onRequestDelete) && (
          <div className="ml-auto flex items-center gap-2">
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
        className="mt-1 w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs text-muted-foreground hover:border-border focus:border-border focus:bg-background/60 focus:outline-none"
      />
    </div>
  );
}
