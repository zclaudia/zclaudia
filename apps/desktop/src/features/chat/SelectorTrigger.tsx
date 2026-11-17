import type { ReactNode } from 'react';
import { Tooltip } from '../../components/ui/Tooltip';

interface SelectorTriggerProps {
  onClick: () => void;
  disabled?: boolean;
  locked?: boolean;
  lockReason?: string;
  title?: string;
  ariaLabel?: string;
  ariaHasPopup?: 'listbox' | 'menu' | 'dialog';
  ariaExpanded?: boolean;
  ariaPressed?: boolean;
  className?: string;
  /** `chip`: the larger pill used inside the mobile composer card. */
  variant?: 'default' | 'chip';
  /** Pressed/open look for toggles and expanded menus (chip variant). */
  active?: boolean;
  children: ReactNode;
}

const BASE_CLASS: Record<'default' | 'chip', string> = {
  // Taller on touch so the composer selectors clear a finger; desktop keeps
  // the compact 28px row.
  default:
    'flex min-w-0 items-center gap-1 px-1.5 py-1 rounded-md text-xs font-medium transition-colors h-11 md:h-7',
  chip: 'flex min-w-0 items-center gap-1.5 px-2.5 rounded-full text-[13px] transition-colors h-11 md:h-9',
};

export function SelectorTrigger({
  onClick,
  disabled,
  locked,
  lockReason,
  title,
  ariaLabel,
  ariaHasPopup,
  ariaExpanded,
  ariaPressed,
  className = '',
  variant = 'default',
  active = false,
  children,
}: SelectorTriggerProps) {
  const effectiveDisabled = !!(disabled || locked);
  const effectiveTitle = locked ? lockReason || title || '已锁定' : title;
  const stateClass =
    disabled && !locked
      ? 'opacity-50 cursor-not-allowed text-muted-foreground'
      : locked
        ? 'cursor-not-allowed text-warning bg-warning/10 border border-warning/30'
        : active
          ? 'cursor-pointer bg-card text-foreground font-medium shadow-sm'
          : 'hover:bg-muted active:bg-muted/80 cursor-pointer text-muted-foreground hover:text-foreground';

  const control = (
    <button
      type="button"
      onClick={() => {
        if (!effectiveDisabled) onClick();
      }}
      aria-disabled={effectiveDisabled || undefined}
      aria-label={ariaLabel}
      aria-description={effectiveTitle}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
      aria-pressed={ariaPressed}
      className={[
        BASE_CLASS[variant],
        'outline-none focus-visible:ring-2 focus-visible:ring-ring',
        stateClass,
        className,
      ].join(' ')}
    >
      {children}
    </button>
  );

  return (
    <>
      {effectiveTitle ? (
        <Tooltip
          content={effectiveTitle}
          disabled={ariaExpanded}
          anchorClassName="inline-flex min-w-0 max-w-full"
        >
          {control}
        </Tooltip>
      ) : (
        control
      )}
    </>
  );
}
