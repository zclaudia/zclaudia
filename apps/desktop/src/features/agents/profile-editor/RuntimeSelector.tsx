import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { ProfileConfigDescriptor } from '@zclaudia/shared/core/profile-config-descriptor';
import { FIELD_CLASS, SELECT_POPOVER_CLASS } from './styles';

/** Runtime type is an open string set — plugins can register additional runtimes. */
export type RuntimeOption = string;

export function RuntimeSelector({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
}: {
  value: RuntimeOption;
  onChange: (v: RuntimeOption) => void;
  options: ProfileConfigDescriptor[];
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

  const selected = options.find(o => o.runtime === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={ariaLabel}
        className={`${FIELD_CLASS} flex items-center justify-between text-left`}
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown
          size={14}
          className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className={SELECT_POPOVER_CLASS}>
          {options.map(opt => (
            <button
              key={opt.runtime}
              type="button"
              onClick={() => {
                onChange(opt.runtime);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                opt.runtime === value
                  ? 'text-primary font-medium bg-muted/40'
                  : 'text-foreground hover:bg-secondary/80'
              }`}
            >
              <span className="w-4 flex-shrink-0">
                {opt.runtime === value && <Check size={14} strokeWidth={2.5} />}
              </span>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
