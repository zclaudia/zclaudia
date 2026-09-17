import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { LlmProfileConfig } from '@zclaudia/shared';
import { FieldLabel } from '../ui/EditorSection';
import { FIELD_CLASS, SELECT_POPOVER_CLASS } from './styles';

export function LlmProfileSelector({
  value,
  onChange,
  profiles,
  hideLabel = false,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  profiles: LlmProfileConfig[];
  hideLabel?: boolean;
  'aria-label'?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selected = profiles.find(p => p.id === value);

  return (
    <div ref={ref} className="relative">
      {!hideLabel && <FieldLabel>LLM Profile *</FieldLabel>}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={ariaLabel}
        className={`${FIELD_CLASS} flex items-center justify-between text-left`}
      >
        <span>
          {selected
            ? selected.name
            : profiles.length === 0
              ? 'No LLM profiles available'
              : 'Select an LLM profile'}
        </span>
        <ChevronDown
          size={14}
          className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && profiles.length > 0 && (
        <div className={SELECT_POPOVER_CLASS}>
          {profiles.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onChange(p.id);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                p.id === value
                  ? 'text-primary font-medium bg-muted/40'
                  : 'text-foreground hover:bg-secondary/80'
              }`}
            >
              <span className="w-4 flex-shrink-0">
                {p.id === value && <Check size={14} strokeWidth={2.5} />}
              </span>
              <span className="truncate">{p.name}</span>
              {p.isDefault && (
                <span className="ml-auto px-1.5 py-0.5 bg-muted/60 text-primary text-[10px] rounded-md">
                  Default
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
