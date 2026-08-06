import { ChevronLeft, Menu } from 'lucide-react';
import { BrandMark } from '../components/BrandMark';
import { PluginWindowButtons } from './PluginDock';

// This header only mounts on mobile (see App.tsx) — desktop relocates its
// controls (sidebar toggle, notifications, window manager) into the
// sidebar's own header instead. Keep this component free of desktop-only
// code paths so it doesn't pull in unconditional Tauri-only imports.
interface AppHeaderProps {
  isMobile: boolean;
  isAgentExpanded: boolean;
  onOpenSidebar: () => void;
  onCloseAgent: () => void;
}

export function AppHeader({
  isMobile,
  isAgentExpanded,
  onOpenSidebar,
  onCloseAgent,
}: AppHeaderProps) {
  return (
    <header
      className="h-12 md:h-14 border-b border-border flex items-center px-2 md:px-4 bg-card flex-shrink-0"
      data-tauri-drag-region
    >
      {/* Left section: Logo and app name */}
      <div className="flex items-center gap-2 md:gap-3 flex-shrink-0" data-tauri-drag-region>
        {/* Mobile buttons keep the larger touch target (p-2) instead of IconButton's 28px. */}
        {isMobile && isAgentExpanded ? (
          <button
            onClick={onCloseAgent}
            className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground flex-shrink-0"
            aria-label="Close agent"
          >
            <ChevronLeft size={20} strokeWidth={1.75} />
          </button>
        ) : isMobile ? (
          <button
            onClick={onOpenSidebar}
            className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground flex-shrink-0"
            aria-label="Open menu"
          >
            <Menu size={20} strokeWidth={1.75} />
          </button>
        ) : null}

        <div className="hidden md:flex items-center gap-2" data-tauri-drag-region>
          <div className="w-7 h-7 rounded-xl border border-border/70 bg-card/80 shadow-apple-sm backdrop-blur-sm flex items-center justify-center flex-shrink-0">
            <BrandMark className="w-[1.625rem] h-[1.625rem] object-contain pointer-events-none select-none drop-shadow-sm" />
          </div>
          <span
            className="font-semibold text-sm text-foreground leading-tight"
            data-tauri-drag-region
          >
            ZClaudia
          </span>
        </div>
      </div>

      {/* Center section: title (mobile only) */}
      <div className="flex-1 flex items-center justify-start ml-2 md:ml-4 min-w-0 gap-2">
        {isMobile && (
          <span className="font-semibold text-sm text-foreground">
            {isAgentExpanded ? 'Claudia' : 'ZClaudia'}
          </span>
        )}
      </div>

      <PluginWindowButtons />
    </header>
  );
}
