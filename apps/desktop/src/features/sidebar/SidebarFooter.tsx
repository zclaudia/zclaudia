import { Settings } from 'lucide-react';
import type { SidebarFooterProps } from './types';

export function SidebarFooter({ onShowSettings, isMobile }: SidebarFooterProps) {
  if (isMobile) {
    return (
      <>
        <div className="mx-3 border-t border-border" aria-hidden />
        <div className="p-2">
          <button
            onClick={() => onShowSettings()}
            data-testid="settings-button"
            className="w-full text-left px-3 py-3 rounded-md text-sm text-muted-foreground hover:bg-secondary active:bg-secondary hover:text-foreground flex items-center gap-2"
          >
            <Settings className="w-5 h-5" strokeWidth={1.75} />
            Settings
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mx-3 border-t border-border" aria-hidden />
      <div className="p-2 space-y-0.5">
        <button
          onClick={() => onShowSettings()}
          data-testid="settings-button"
          className="w-full text-left px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-secondary hover:text-foreground flex items-center gap-2"
        >
          <Settings className="w-4 h-4" strokeWidth={1.75} />
          Settings
        </button>
      </div>
    </>
  );
}
