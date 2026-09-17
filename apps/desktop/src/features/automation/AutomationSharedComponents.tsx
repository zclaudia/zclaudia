/**
 * The one list-page vocabulary every automation tab is built from.
 *
 * Every tab renders the same skeleton — `TabToolbar` (count + ghost controls)
 * → `SectionGroup` (sentence-case label) → `ListCard` rows — so the five tabs
 * read as one surface. Rows are three-slot: a 16px lead (status dot / icon),
 * the text column (14px title + 12px meta), and a trailing control cluster.
 * Status color only ever comes from the tone map (ui-conventions rule 1).
 */
import type { ReactNode, HTMLAttributes } from 'react';
import { Loader2, Zap, type LucideIcon } from 'lucide-react';
import { SECTION_LABEL } from '../../components/ui/typography';
import { TONE_BADGE, TONE_DOT, type Tone } from '../../components/ui/tone';

export function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 size={20} className="animate-spin text-muted-foreground" />
    </div>
  );
}

export function EmptyState({
  message,
  subtitle,
  icon: Icon = Zap,
}: {
  message: string;
  subtitle?: string;
  /** Tab-specific glyph; the lightning bolt only fits the Automations tab. */
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <Icon size={24} strokeWidth={1.75} className="mb-2 opacity-40" />
      <p className="text-sm">{message}</p>
      {subtitle && <p className="text-xs mt-1 text-muted-foreground/60">{subtitle}</p>}
    </div>
  );
}

/**
 * First row of every tab: `N things` on the left, ghost controls on the right.
 * Refresh is always the right-most control; at most one sibling is solid.
 */
export function TabToolbar({
  count,
  noun,
  unknown = false,
  children,
}: {
  count: number;
  /** Singular form; pluralized with `s` unless `plural` is given. */
  noun: string | { one: string; other: string };
  /** Nothing loaded yet (every backend failed): a stale "0" next to an error
   *  banner reads as "the backend has no data", so show an ellipsis instead. */
  unknown?: boolean;
  children?: ReactNode;
}) {
  const label = unknown
    ? '…'
    : typeof noun === 'string'
      ? `${count} ${noun}${count !== 1 ? 's' : ''}`
      : `${count} ${count === 1 ? noun.one : noun.other}`;
  return (
    <div className="flex items-center justify-between gap-3 min-h-7">
      <h2 className="text-sm font-medium text-muted-foreground tabular-nums">{label}</h2>
      {children && <div className="flex items-center gap-1">{children}</div>}
    </div>
  );
}

/** A labelled group of rows. Label is the canonical SECTION_LABEL. */
export function SectionGroup({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div>
      <h3 className={`${SECTION_LABEL} mb-2`}>{label}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

/** Solid 8px status dot for the lead slot. */
export function StatusDot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      className={`block h-2 w-2 rounded-full ${TONE_DOT[tone]} ${pulse ? 'animate-pulse' : ''}`}
    />
  );
}

/** Tinted label chip — rounded-md, 11px, tone-map colors only. */
export function ToneBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex h-[18px] shrink-0 items-center rounded-md px-1.5 text-2xs font-medium leading-none whitespace-nowrap ${TONE_BADGE[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * The `·` between meta chunks. Hidden below `md`: chunks wrap there, and a
 * separator that lands at a line end reads as a stray bullet — the wider
 * mobile gap does the separating instead.
 */
export function MetaSep() {
  return (
    <span aria-hidden className="text-muted-foreground/50 max-md:hidden">
      ·
    </span>
  );
}

interface ListCardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** 16px lead slot: a StatusDot, a spinner, or a monochrome lucide icon. */
  lead?: ReactNode;
  /** Row name; wraps to two lines below `md` where it is the only differentiator. */
  title: ReactNode;
  /** Chips rendered right after the title (tone badges, `<code>` type ids). */
  titleExtra?: ReactNode;
  /** Second line: 12px muted chunks separated by `<MetaSep />`. Wraps as chunks. */
  meta?: ReactNode;
  /** Trailing control cluster (icon buttons, a chevron, a timestamp). */
  trail?: ReactNode;
  /** Renders the row as a button. */
  onClick?: () => void;
  selected?: boolean;
  /** Dimmed treatment for disabled records. */
  muted?: boolean;
}

export function ListCard({
  lead,
  title,
  titleExtra,
  meta,
  trail,
  onClick,
  selected = false,
  muted = false,
  className = '',
  ...rest
}: ListCardProps) {
  const surface = muted
    ? 'border-border/50 bg-muted/30'
    : onClick
      ? 'border-border bg-card hover:bg-secondary/60'
      : 'border-border bg-card';
  const base =
    `flex w-full min-h-[52px] items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ` +
    `${surface} ${selected ? 'ring-2 ring-primary ' : ''}${className}`;

  const body = (
    <>
      {lead !== undefined && (
        <span
          className={`flex w-4 shrink-0 items-center justify-center text-muted-foreground ${muted ? 'opacity-60' : ''}`}
        >
          {lead}
        </span>
      )}
      <span className={`flex min-w-0 flex-1 flex-col gap-0.5 ${muted ? 'opacity-60' : ''}`}>
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-foreground max-md:line-clamp-2 max-md:whitespace-normal">
            {title}
          </span>
          {titleExtra}
        </span>
        {meta && (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground max-md:gap-x-3">
            {meta}
          </span>
        )}
      </span>
      {trail && <span className="flex shrink-0 items-center gap-1">{trail}</span>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={base}
        {...(rest as HTMLAttributes<HTMLButtonElement>)}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={base} {...(rest as HTMLAttributes<HTMLDivElement>)}>
      {body}
    </div>
  );
}

/** Sentence-case a lowercase category id (`maintenance` → `Maintenance`). */
export function categoryLabel(category: string): string {
  if (!category) return 'Other';
  if (category === category.toUpperCase()) return category; // already an acronym like "AI"
  return category.charAt(0).toUpperCase() + category.slice(1);
}
