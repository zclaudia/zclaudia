import { useEffect, useRef, useState } from 'react';
import { ChevronRight, CircleX, TriangleAlert } from 'lucide-react';
import type { BrowserConsoleEntry } from '@zclaudia/shared';

interface Props {
  entries: BrowserConsoleEntry[];
}

const LEVEL_TEXT: Record<BrowserConsoleEntry['level'], string> = {
  error: 'text-destructive',
  warn: 'text-warning',
  info: 'text-muted-foreground',
  log: 'text-muted-foreground',
  debug: 'text-muted-foreground/60',
};

/** Collapsible page-console footer under the browser viewport. */
export function ConsoleStrip({ entries }: Props) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const errors = entries.reduce((n, e) => n + (e.level === 'error' ? 1 : 0), 0);
  const warnings = entries.reduce((n, e) => n + (e.level === 'warn' ? 1 : 0), 0);

  // Follow the tail while open (console UX convention).
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
        Console
        <span className="flex-1" />
        {errors > 0 && (
          <span className="flex items-center gap-1 text-destructive">
            <CircleX size={12} strokeWidth={1.75} aria-hidden />
            {errors}
          </span>
        )}
        {warnings > 0 && (
          <span className="flex items-center gap-1 text-warning">
            <TriangleAlert size={12} strokeWidth={1.75} aria-hidden />
            {warnings}
          </span>
        )}
      </button>
      {open && (
        <div ref={listRef} className="max-h-48 overflow-y-auto border-t border-border px-2 py-1">
          {entries.length === 0 ? (
            <div className="py-1 text-[11px] text-muted-foreground/60">No console output</div>
          ) : (
            entries.map((e, i) => (
              <div key={`${e.ts}-${i}`} className={`py-0.5 text-[11px] font-mono whitespace-pre-wrap break-words ${LEVEL_TEXT[e.level]}`}>
                {e.text}
                {e.location && <span className="text-muted-foreground/60"> {e.location}</span>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
