import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

export interface ActionsMenuAction {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/** The "⋯" dropdown used on library cards and editor headers. The parent
 *  controls positioning — this renders as an inline relative container. */
export function ActionsMenu({
  actions,
  ariaLabel = 'More actions',
}: {
  actions: ActionsMenuAction[];
  ariaLabel?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(open => !open)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <MoreHorizontal size={16} strokeWidth={1.75} />
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setMenuOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 top-full z-[80] mt-1 min-w-48 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-md"
          >
            {actions.map(action => (
              <button
                key={action.label}
                role="menuitem"
                type="button"
                disabled={action.disabled}
                onClick={() => {
                  setMenuOpen(false);
                  action.onSelect();
                }}
                className={`flex w-full px-3 py-1.5 text-left text-xs hover:bg-secondary disabled:pointer-events-none disabled:opacity-50 ${
                  action.destructive
                    ? 'text-destructive hover:bg-destructive/10'
                    : 'text-foreground'
                }`}
              >
                {action.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
