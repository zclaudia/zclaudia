import { Home, Workflow } from 'lucide-react';

interface SidebarNavProps {
  /** Navigate to the welcome screen (deselect session + exit any dashboard). */
  onHome: () => void;
  /** Whether the welcome screen is currently showing (no session, no dashboard). */
  isHomeActive: boolean;
  /** Open the automations window. Omitted (e.g. on mobile) hides the entry. */
  onOpenAutomations?: () => void;
  isMobile?: boolean;
}

/**
 * Top-of-sidebar navigation cluster: app-level destinations that aren't tied to
 * a specific project or session. Pinned above the scrollable project list.
 */
export function SidebarNav({ onHome, isHomeActive, onOpenAutomations, isMobile }: SidebarNavProps) {
  const rowBase = isMobile
    ? 'w-full text-left px-3 py-3 rounded-md text-sm hover:bg-secondary active:bg-secondary hover:text-foreground flex items-center gap-2'
    : 'w-full text-left px-2 py-1.5 rounded-md text-sm hover:bg-secondary hover:text-foreground flex items-center gap-2';
  const iconSize = isMobile ? 'w-5 h-5' : 'w-4 h-4';

  return (
    <div className="p-2 space-y-0.5 border-b border-border">
      <button
        onClick={onHome}
        aria-label="Home"
        className={`${rowBase} ${isHomeActive ? 'bg-secondary text-foreground' : 'text-muted-foreground'}`}
      >
        <Home className={iconSize} strokeWidth={1.75} />
        Home
      </button>

      {onOpenAutomations && (
        <button
          onClick={onOpenAutomations}
          aria-label="Automations"
          className={`${rowBase} text-muted-foreground`}
        >
          <Workflow className={iconSize} strokeWidth={1.75} />
          Automations
        </button>
      )}
    </div>
  );
}
