import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, RotateCw, Smartphone, SquareDashedMousePointer, X } from 'lucide-react';
import type { BrowserPageState } from '@zclaudia/shared';

interface Props {
  state: BrowserPageState | null;
  agentActive: boolean;
  emulationActive: boolean;
  pickActive: boolean;
  onNavigate(url: string): void;
  onHistory(direction: 'back' | 'forward'): void;
  onReload(): void;
  onStop(): void;
  onToggleEmulation(): void;
  onTogglePick(): void;
  onOpenExternal(): void;
}

const BTN =
  'h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:pointer-events-none';

export function BrowserToolbar({
  state,
  agentActive,
  emulationActive,
  pickActive,
  onNavigate,
  onHistory,
  onReload,
  onStop,
  onToggleEmulation,
  onTogglePick,
  onOpenExternal,
}: Props) {
  const [draft, setDraft] = useState(state?.url ?? '');
  const editing = useRef(false);

  // Follow server-side navigation unless the user is mid-edit.
  useEffect(() => {
    if (!editing.current) setDraft(state?.url ?? '');
  }, [state?.url]);

  return (
    <div className="flex items-center gap-1 px-2 h-9 border-b border-border">
      <button aria-label="Back" className={BTN} disabled={!state?.canGoBack} onClick={() => onHistory('back')}>
        <ArrowLeft size={14} strokeWidth={1.75} />
      </button>
      <button aria-label="Forward" className={BTN} disabled={!state?.canGoForward} onClick={() => onHistory('forward')}>
        <ArrowRight size={14} strokeWidth={1.75} />
      </button>
      {state?.loading ? (
        <button aria-label="Stop" className={BTN} onClick={onStop}>
          <X size={14} strokeWidth={1.75} />
        </button>
      ) : (
        <button aria-label="Reload" className={BTN} onClick={onReload}>
          <RotateCw size={14} strokeWidth={1.75} />
        </button>
      )}
      <input
        aria-label="Address"
        className="flex-1 min-w-0 h-7 px-2 rounded-md bg-secondary/50 text-sm font-mono text-foreground outline-none focus:ring-1 focus:ring-ring"
        value={draft}
        spellCheck={false}
        onFocus={(e) => {
          editing.current = true;
          e.currentTarget.select();
        }}
        onBlur={() => {
          editing.current = false;
          setDraft(state?.url ?? '');
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            onNavigate(draft.trim());
            editing.current = false;
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            e.currentTarget.blur();
          }
        }}
      />
      {agentActive && (
        <span className="flex items-center gap-1.5 px-1.5 text-[11px] font-medium text-muted-foreground">
          {/* Semantic "active" dot per docs/ui-conventions.md #1 (status dots use bg-success, not raw palette classes). */}
          <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" aria-hidden />
          Agent
        </span>
      )}
      <button
        aria-label="Select element to chat"
        aria-pressed={pickActive}
        className={`${BTN} ${pickActive ? 'bg-secondary text-foreground' : ''}`}
        onClick={onTogglePick}
      >
        <SquareDashedMousePointer size={14} strokeWidth={1.75} />
      </button>
      <button
        aria-label="Toggle device emulation"
        aria-pressed={emulationActive}
        className={`${BTN} ${emulationActive ? 'bg-secondary text-foreground' : ''}`}
        onClick={onToggleEmulation}
      >
        <Smartphone size={14} strokeWidth={1.75} />
      </button>
      <button aria-label="Open in external browser" className={BTN} onClick={onOpenExternal}>
        <ExternalLink size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}
