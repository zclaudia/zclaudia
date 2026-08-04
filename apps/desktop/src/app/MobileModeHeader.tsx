import { ChevronLeft, Menu } from 'lucide-react';
import { IconButton } from '../components/ui/Button';

interface MobileModeHeaderProps {
  /** Mode name shown next to the back affordance (e.g. "Automations"). */
  title: string;
  /** Return to the app mode. */
  onBack: () => void;
  /** Open the sidebar drawer (the mode's tab nav lives there on mobile). */
  onOpenSidebar: () => void;
}

/**
 * Mobile-only header for the top-level shell modes (Automations / Agents /
 * Extensions). Desktop keeps these controls in the sidebar, but on mobile the
 * drawer is closed by default and AppHeader hides itself — without this bar a
 * shell mode would have no visible way back to the app or into the drawer.
 * Mirrors SettingsPanel's mobile header pattern.
 */
export function MobileModeHeader({ title, onBack, onOpenSidebar }: MobileModeHeaderProps) {
  return (
    <div className="flex items-center justify-between px-3 py-3 border-b border-border bg-card flex-shrink-0">
      <div className="flex items-center gap-2">
        <IconButton onClick={onBack} aria-label="Back to app">
          <ChevronLeft className="w-5 h-5" strokeWidth={1.75} />
        </IconButton>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <IconButton onClick={onOpenSidebar} aria-label="Open menu">
        <Menu className="w-5 h-5" strokeWidth={1.75} />
      </IconButton>
    </div>
  );
}
