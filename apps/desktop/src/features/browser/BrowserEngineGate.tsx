import { Globe } from 'lucide-react';
import type { BrowserEngineView } from './browserStore';

interface Props {
  engine: BrowserEngineView;
  onInstall(): void;
}

export function BrowserEngineGate({ engine, onInstall }: Props) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <Globe size={24} strokeWidth={1.75} className="text-muted-foreground" />
      {engine.status === 'downloading' ? (
        <>
          <div className="text-sm text-foreground">Downloading Chromium…</div>
          <div className="text-[11px] font-medium text-muted-foreground">
            {Math.round((engine.progress ?? 0) * 100)}%
          </div>
        </>
      ) : (
        <>
          <div className="text-sm text-foreground">No Chromium-based browser found</div>
          <div className="text-[11px] font-medium text-muted-foreground max-w-64">
            Install Google Chrome or Chromium on the server machine, set ZCLAUDIA_CHROME_PATH, or download a copy for zclaudia.
          </div>
          {engine.status === 'error' && engine.message && (
            <div className="text-[11px] font-medium text-destructive">{engine.message}</div>
          )}
          <button
            className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90"
            onClick={onInstall}
          >
            Download Chromium
          </button>
        </>
      )}
    </div>
  );
}
