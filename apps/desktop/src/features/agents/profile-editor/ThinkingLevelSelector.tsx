import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { ThinkingLevel } from '@zclaudia/shared';
import { FieldLabel } from '../ui/EditorSection';
import { FIELD_CLASS, SELECT_POPOVER_CLASS } from './styles';

export type ThinkingLevelOption = '' | ThinkingLevel;

const THINKING_LEVEL_OPTIONS: { value: ThinkingLevelOption; label: string }[] = [
  { value: '', label: 'Auto' },
  { value: 'off', label: 'off' },
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
];

export function ThinkingLevelSelector({
  value,
  onChange,
  hideLabel = false,
  'aria-label': ariaLabel,
}: {
  value: ThinkingLevelOption;
  onChange: (v: ThinkingLevelOption) => void;
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

  const selected = THINKING_LEVEL_OPTIONS.find(o => o.value === value);

  return (
    <div ref={ref} className="relative">
      {!hideLabel && <FieldLabel>Thinking Level</FieldLabel>}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={ariaLabel}
        className={`${FIELD_CLASS} flex items-center justify-between text-left`}
      >
        <span>{selected?.label ?? 'Auto'}</span>
        <ChevronDown
          size={14}
          className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className={SELECT_POPOVER_CLASS}>
          {THINKING_LEVEL_OPTIONS.map(opt => (
            <button
              key={opt.value || 'auto'}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                opt.value === value
                  ? 'text-primary font-medium bg-muted/40'
                  : 'text-foreground hover:bg-secondary/80'
              }`}
            >
              <span className="w-4 flex-shrink-0">
                {opt.value === value && <Check size={14} strokeWidth={2.5} />}
              </span>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
