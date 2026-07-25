import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Action-menu primitive extracted from Select's open/dismiss/keyboard
 * machinery, replacing the hand-rolled dropdowns (document-mousedown listeners
 * and fixed-inset click shields) that mostly lacked Escape handling, arrow-key
 * roving, and focus return.
 *
 * The panel renders in a body portal with fixed positioning, so it escapes
 * scrollable/overflow-hidden parents, and clamps to the viewport with an 8px
 * margin (flipping above the trigger when there is no room below).
 */
export interface DropdownMenuItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

export type DropdownMenuEntry = DropdownMenuItem | 'separator';

interface TriggerArgs {
  ref: (el: HTMLButtonElement | null) => void;
  props: {
    type: 'button';
    'aria-haspopup': 'menu';
    'aria-expanded': boolean;
    'aria-controls': string | undefined;
    onClick: (e: React.MouseEvent) => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
  };
  open: boolean;
}

interface DropdownMenuProps {
  entries: DropdownMenuEntry[];
  /** Render the trigger button; spread `props` onto it and attach `ref`. */
  trigger: (args: TriggerArgs) => ReactNode;
  align?: 'start' | 'end';
  /** Accessible name for the menu. */
  ariaLabel: string;
  panelClassName?: string;
}

const VIEWPORT_MARGIN = 8;

export function DropdownMenu({
  entries,
  trigger,
  align = 'start',
  ariaLabel,
  panelClassName = '',
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const items = entries.filter((e): e is DropdownMenuItem => e !== 'separator');

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setPanelStyle({ visibility: 'hidden' });
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Position after render so the real panel size drives the clamping math.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    const panel = panelRef.current;
    if (!rect || !panel) return;
    const { width, height } = panel.getBoundingClientRect();
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, rect.top - height - 4);
    }
    let left = align === 'end' ? rect.right - width : rect.left;
    left = Math.min(Math.max(left, VIEWPORT_MARGIN), window.innerWidth - width - VIEWPORT_MARGIN);
    setPanelStyle({ top, left });
  }, [open, align]);

  // Focus the first enabled item on open (menu convention).
  useEffect(() => {
    if (!open) return;
    const first = items.findIndex(item => !item.disabled);
    if (first >= 0) itemRefs.current[first]?.focus();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Outside mousedown + window resize/scroll dismiss.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        close(false);
      }
    };
    const onReposition = () => close(false);
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('resize', onReposition);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('resize', onReposition);
    };
  }, [open, close]);

  const moveFocus = (dir: 1 | -1) => {
    const enabled = itemRefs.current
      .map((el, i) => ({ el, i }))
      .filter(({ el, i }) => el && !items[i]?.disabled);
    if (enabled.length === 0) return;
    const current = enabled.findIndex(({ el }) => el === document.activeElement);
    const next = enabled[(current + dir + enabled.length) % enabled.length];
    next.el?.focus();
  };

  const handlePanelKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close(true);
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveFocus(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveFocus(-1);
        break;
      case 'Home':
        e.preventDefault();
        itemRefs.current[items.findIndex(item => !item.disabled)]?.focus();
        break;
      case 'End': {
        e.preventDefault();
        const last = items.map(item => !item.disabled).lastIndexOf(true);
        itemRefs.current[last]?.focus();
        break;
      }
      case 'Tab':
        close(false);
        break;
    }
  };

  const handleSelect = (item: DropdownMenuItem) => {
    if (item.disabled) return;
    close(true);
    item.onSelect();
  };

  let itemIndex = -1;
  const panel = open && (
    <div
      ref={panelRef}
      id={menuId}
      role="menu"
      aria-label={ariaLabel}
      onKeyDown={handlePanelKeyDown}
      style={panelStyle}
      className={`fixed z-nested min-w-[160px] rounded-xl border border-border/50 bg-popover/95 glass py-1 shadow-apple-xl animate-apple-fade-in ${panelClassName}`.trim()}
    >
      {entries.map((entry, i) => {
        if (entry === 'separator') {
          return <div key={`sep-${i}`} role="separator" className="my-1 border-t border-border" />;
        }
        itemIndex += 1;
        const idx = itemIndex;
        return (
          <button
            key={entry.key}
            ref={el => {
              itemRefs.current[idx] = el;
            }}
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={entry.disabled}
            onClick={() => handleSelect(entry)}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] outline-none transition-colors disabled:opacity-50 ${
              entry.destructive
                ? 'text-destructive hover:bg-destructive/10 focus:bg-destructive/10'
                : 'text-foreground hover:bg-muted focus:bg-muted'
            }`}
          >
            {entry.icon && (
              <span className="flex w-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:h-3.5 [&>svg]:w-3.5">
                {entry.icon}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      {trigger({
        ref: el => {
          triggerRef.current = el;
        },
        props: {
          type: 'button',
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          'aria-controls': open ? menuId : undefined,
          onClick: e => {
            e.stopPropagation();
            setOpen(v => !v);
          },
          onKeyDown: e => {
            if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault();
              setOpen(true);
            }
          },
        },
        open,
      })}
      {panel && createPortal(panel, document.body)}
    </>
  );
}
