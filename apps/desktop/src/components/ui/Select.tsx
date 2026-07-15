import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  useId,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export type SelectSize = 'sm' | 'md' | 'lg';
export type SelectPanelPosition = 'absolute' | 'fixed';

export interface SelectProps<T extends string = string> {
  value: T | '';
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: ReactNode;
  disabled?: boolean;
  size?: SelectSize;
  block?: boolean;
  className?: string;
  triggerClassName?: string;
  panelClassName?: string;
  /** Render the menu at viewport level to escape a scrollable parent such as a modal. */
  panelPosition?: SelectPanelPosition;
  title?: string;
  align?: 'left' | 'right';
  ariaLabel?: string;
}

const SIZE_CLASSES: Record<SelectSize, { trigger: string; panelText: string }> = {
  sm: {
    trigger: 'h-6 px-2 text-[11px] gap-1',
    panelText: 'text-[11px]',
  },
  md: {
    trigger: 'h-7 px-2.5 text-[12px] gap-1.5',
    panelText: 'text-[12px]',
  },
  lg: {
    trigger: 'h-[38px] px-3 text-sm gap-1.5',
    panelText: 'text-sm',
  },
};

export function Select<T extends string = string>({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  size = 'sm',
  block = false,
  className = '',
  triggerClassName = '',
  panelClassName = '',
  panelPosition = 'absolute',
  title,
  align = 'left',
  ariaLabel,
}: SelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>();
  // Highlighted option for keyboard navigation (roving focus among options).
  const [activeIndex, setActiveIndex] = useState(-1);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const typeahead = useRef<{ query: string; timer: number | null }>({ query: '', timer: null });
  const listboxId = useId();

  const selected = useMemo(() => options.find(opt => opt.value === value), [options, value]);
  const sizing = SIZE_CLASSES[size];

  const firstEnabled = useCallback(
    (from: number, dir: 1 | -1) => {
      const n = options.length;
      if (n === 0) return -1;
      let i = from;
      for (let step = 0; step < n; step++) {
        if (i >= 0 && i < n && !options[i].disabled) return i;
        i += dir;
        if (i < 0) i = n - 1;
        if (i >= n) i = 0;
      }
      return -1;
    },
    [options]
  );

  // On open, highlight the selected option (or the first enabled one).
  useEffect(() => {
    if (!isOpen) {
      setActiveIndex(-1);
      return;
    }
    const selIdx = options.findIndex(opt => opt.value === value && !opt.disabled);
    setActiveIndex(selIdx >= 0 ? selIdx : firstEnabled(0, 1));
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Move DOM focus to the highlighted option so screen readers announce it.
  useEffect(() => {
    if (isOpen && activeIndex >= 0) optionRefs.current[activeIndex]?.focus();
  }, [isOpen, activeIndex]);

  const moveActive = useCallback(
    (dir: 1 | -1) => {
      setActiveIndex(cur => {
        const n = options.length;
        if (n === 0) return -1;
        let i = cur < 0 ? (dir === 1 ? -1 : 0) : cur;
        for (let step = 0; step < n; step++) {
          i = (i + dir + n) % n;
          if (!options[i].disabled) return i;
        }
        return cur;
      });
    },
    [options]
  );

  const runTypeahead = useCallback(
    (char: string) => {
      const ta = typeahead.current;
      if (ta.timer) window.clearTimeout(ta.timer);
      ta.query += char.toLowerCase();
      const match = options.findIndex(
        opt =>
          !opt.disabled &&
          typeof opt.label === 'string' &&
          opt.label.toLowerCase().startsWith(ta.query)
      );
      if (match >= 0) setActiveIndex(match);
      ta.timer = window.setTimeout(() => {
        ta.query = '';
        ta.timer = null;
      }, 500);
    },
    [options]
  );

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !containerRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  const updateFixedPanelPosition = useCallback(() => {
    if (panelPosition !== 'fixed') return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPanelStyle({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, [panelPosition]);

  useEffect(() => {
    if (!isOpen || panelPosition !== 'fixed') return;
    updateFixedPanelPosition();
    window.addEventListener('resize', updateFixedPanelPosition);
    window.addEventListener('scroll', updateFixedPanelPosition, true);
    return () => {
      window.removeEventListener('resize', updateFixedPanelPosition);
      window.removeEventListener('scroll', updateFixedPanelPosition, true);
    };
  }, [isOpen, panelPosition, updateFixedPanelPosition]);

  const handleSelect = useCallback(
    (next: T, optionDisabled: boolean | undefined) => {
      if (optionDisabled) return;
      onChange(next);
      setIsOpen(false);
      triggerRef.current?.focus();
    },
    [onChange]
  );

  const triggerLabel = selected ? selected.label : (placeholder ?? '');

  const handlePanelKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveActive(-1);
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(firstEnabled(0, 1));
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(firstEnabled(options.length - 1, -1));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (activeIndex >= 0) handleSelect(options[activeIndex].value, options[activeIndex].disabled);
        break;
      case 'Tab':
        setIsOpen(false); // let focus proceed to the next control
        break;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) runTypeahead(e.key);
    }
  };

  const activeOptionId = activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined;

  const panel = isOpen && (
    <div
      ref={panelRef}
      id={listboxId}
      role="listbox"
      aria-activedescendant={activeOptionId}
      onKeyDown={handlePanelKeyDown}
      style={panelPosition === 'fixed' ? panelStyle : undefined}
      className={`
        ${panelPosition === 'fixed' ? 'fixed z-[110]' : 'absolute z-50 mt-1 min-w-full'}
        ${align === 'right' && panelPosition === 'absolute' ? 'right-0' : 'left-0'}
        bg-popover/95 glass border border-border/50
        rounded-xl shadow-apple-xl py-1
        max-h-[280px] overflow-y-auto
        animate-apple-fade-in
        ${panelClassName}
      `}
    >
      {options.map((opt, index) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            id={`${listboxId}-opt-${index}`}
            ref={el => {
              optionRefs.current[index] = el;
            }}
            tabIndex={-1}
            type="button"
            role="option"
            aria-selected={isActive}
            disabled={opt.disabled}
            onClick={() => handleSelect(opt.value, opt.disabled)}
            className={`
              w-full text-left px-3 py-1.5 ${sizing.panelText}
              flex items-start gap-2
              transition-colors whitespace-nowrap
              outline-none focus:bg-muted
              ${
                opt.disabled
                  ? 'opacity-50 cursor-not-allowed'
                  : isActive
                    ? 'bg-muted/60 text-primary font-medium'
                    : 'text-foreground hover:bg-muted active:bg-muted'
              }
            `}
          >
            <Check
              size={12}
              strokeWidth={2.5}
              className={`mt-[3px] flex-shrink-0 ${isActive ? 'opacity-100 text-primary' : 'opacity-0'}`}
            />
            <span className="flex-1 min-w-0">
              <span className="block truncate">{opt.label}</span>
              {opt.description && (
                <span className="block text-[10px] text-muted-foreground mt-0.5 truncate">
                  {opt.description}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div
      ref={containerRef}
      className={`relative ${block ? 'block w-full' : 'inline-block'} ${className}`}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setIsOpen(v => !v)}
        onKeyDown={e => {
          if (disabled || isOpen) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setIsOpen(true);
          }
        }}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-label={ariaLabel}
        className={`
          flex items-center justify-between w-full
          ${sizing.trigger}
          rounded-full bg-background border border-border
          font-medium
          focus:outline-none focus:ring-1 focus:ring-primary
          transition-colors
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary/40 cursor-pointer'}
          ${triggerClassName}
        `}
      >
        <span className={`truncate text-left ${selected ? '' : 'text-muted-foreground'}`}>
          {triggerLabel}
        </span>
        <ChevronDown
          size={12}
          strokeWidth={2}
          className={`flex-shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {panelPosition === 'fixed' && panel ? createPortal(panel, document.body) : panel}
    </div>
  );
}
