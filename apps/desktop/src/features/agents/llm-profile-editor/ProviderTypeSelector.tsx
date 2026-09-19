import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { FieldLabel } from '../ui/EditorSection';
import { PROVIDER_TYPE_OPTIONS } from './derive';
import { FIELD_CLASS } from './styles';

export function ProviderTypeSelector({
  value,
  onChange,
  hideLabel = false,
}: {
  value: string;
  onChange: (v: string) => void;
  hideLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Roving focus: whenever the popup opens (or the active option changes via
  // arrow keys), move DOM focus onto that option so screen readers announce
  // it and further arrow/Enter/Escape keydowns land on the listbox.
  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  const selectedIndex = PROVIDER_TYPE_OPTIONS.findIndex(o => o.value === value);
  const selected = PROVIDER_TYPE_OPTIONS[selectedIndex];

  const openList = () => {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  const closeList = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const selectOption = (index: number) => {
    const opt = PROVIDER_TYPE_OPTIONS[index];
    if (!opt) return;
    onChange(opt.value);
    closeList();
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openList();
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      closeList();
    }
  };

  const handleOptionKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, PROVIDER_TYPE_OPTIONS.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectOption(index);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeList();
    }
  };

  return (
    <div ref={ref} className="relative">
      {!hideLabel && <FieldLabel>Provider Type</FieldLabel>}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={handleTriggerKeyDown}
        className={`${FIELD_CLASS} flex items-center justify-between text-left`}
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown
          size={14}
          className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Provider Type"
          className="absolute right-0 top-full mt-1 min-w-full w-max max-w-[19rem] bg-popover/95 glass border border-border/50 rounded-xl shadow-apple-xl animate-apple-fade-in z-50 py-1 overflow-hidden"
        >
          {PROVIDER_TYPE_OPTIONS.map((opt, index) => (
            <button
              key={opt.value}
              ref={el => {
                optionRefs.current[index] = el;
              }}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              tabIndex={-1}
              onClick={() => selectOption(index)}
              onKeyDown={e => handleOptionKeyDown(e, index)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left whitespace-nowrap transition-colors ${
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
