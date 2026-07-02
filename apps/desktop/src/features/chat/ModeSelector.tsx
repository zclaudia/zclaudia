import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Lock } from 'lucide-react';
import type { ProviderCapabilities } from '@zclaudia/shared/core/runtime-capabilities';
import { SelectorTrigger } from './SelectorTrigger';

interface ModeSelectorProps {
  capabilities: ProviderCapabilities;
  value: string;
  onChange: (modeId: string) => void;
  disabled?: boolean;
  locked?: boolean;
  lockReason?: string;
}

/**
 * Mode dropdown driven by ProviderCapabilities.modes. When `locked` is true
 * (Supervisor forced), the selector shows a lock icon and is disabled.
 *
 * Hidden entirely when capabilities.modes is empty.
 */
export function ModeSelector({
  capabilities,
  value,
  onChange,
  disabled,
  locked,
  lockReason,
}: ModeSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  if (!capabilities.modes || capabilities.modes.length === 0) return null;

  const effective = value || capabilities.defaultModeId || capabilities.modes[0].id;
  const current = capabilities.modes.find(m => m.id === effective) ?? capabilities.modes[0];
  const isDisabled = disabled || locked;
  const title = locked
    ? (lockReason ?? 'Mode locked')
    : (current.description ?? capabilities.modeLabel ?? 'Mode');

  return (
    <div ref={ref} className="relative inline-block">
      <SelectorTrigger
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        locked={locked}
        lockReason={lockReason}
        title={title}
        ariaHasPopup="listbox"
        ariaExpanded={open}
      >
        {locked ? <Lock size={14} strokeWidth={1.75} /> : null}
        <span>{current.label}</span>
        <ChevronDown size={12} />
      </SelectorTrigger>
      {open && !isDisabled && (
        <div
          role="listbox"
          className="absolute left-0 bottom-full mb-1 z-50 min-w-[140px] bg-popover border border-border rounded-md shadow-lg py-1"
        >
          {capabilities.modes.map(m => (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={m.id === effective}
              onClick={() => {
                onChange(m.id);
                setOpen(false);
              }}
              className={[
                'w-full text-left px-3 py-1.5 text-xs hover:bg-muted',
                m.id === effective ? 'bg-muted/60 font-medium' : '',
              ].join(' ')}
            >
              <div>{m.label}</div>
              {m.description ? (
                <div className="text-[10px] text-muted-foreground">{m.description}</div>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
