/**
 * Canonical section eyebrow / overline label.
 *
 * One token so the app's small uppercase kickers stay consistent instead of
 * drifting across sizes (text-xs vs text-[10px]), tracking (wide vs wider), and
 * weight (medium vs semibold) — that inconsistency reads as templating. Append
 * layout utilities (e.g. `mb-1`) at the call site:
 *
 *   <h4 className={`${EYEBROW} mb-1`}>Scope</h4>
 */
export const EYEBROW = 'text-[11px] font-medium uppercase tracking-wide text-muted-foreground';
