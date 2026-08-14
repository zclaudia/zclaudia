import { useEffect, useRef, useState } from 'react';
import { ChevronRight, CircleX } from 'lucide-react';
import type { BrowserNetworkEntry } from '@zclaudia/shared';

interface Props {
  entries: BrowserNetworkEntry[];
}

function isFailed(e: BrowserNetworkEntry): boolean {
  return e.errorText !== undefined || (e.status !== undefined && e.status >= 400);
}

/** "/api/users" for same-page assets, full origin+path for third parties. */
function displayUrl(raw: string, index: number): string {
  try {
    const u = new URL(raw);
    return `${u.pathname}${u.search}` || u.href;
  } catch {
    return raw || `request ${index}`;
  }
}

/** Collapsible network-request footer under the browser viewport. */
export function NetworkStrip({ entries }: Props) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const failed = entries.reduce((n, e) => n + (isFailed(e) ? 1 : 0), 0);

  // Follow the tail while open, like the console strip.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, entries]);

  return (
    <div className="border-t border-border">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2 h-7 text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight
          size={12}
          strokeWidth={1.75}
          className={`transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden
        />
        Network
        <span className="flex-1" />
        {failed > 0 && (
          <span className="flex items-center gap-1 text-destructive">
            <CircleX size={12} strokeWidth={1.75} aria-hidden />
            {failed}
          </span>
        )}
        {entries.length > 0 && <span className="text-muted-foreground/60">{entries.length}</span>}
      </button>
      {open && (
        <div ref={listRef} className="max-h-48 overflow-y-auto border-t border-border px-2 py-1">
          {entries.length === 0 ? (
            <div className="py-1 text-[11px] text-muted-foreground/60">No requests</div>
          ) : (
            entries.map((e, i) => (
              <div
                key={e.id}
                className={`flex items-baseline gap-2 py-0.5 text-[11px] font-mono ${isFailed(e) ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                <span className="w-8 shrink-0 text-right">{e.errorText ? 'ERR' : (e.status ?? '…')}</span>
                <span className="w-10 shrink-0">{e.method}</span>
                <span className="min-w-0 flex-1 truncate">{displayUrl(e.url, i)}</span>
                {e.durationMs !== undefined && (
                  <span className="shrink-0 text-muted-foreground/60">{Math.round(e.durationMs)}ms</span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
