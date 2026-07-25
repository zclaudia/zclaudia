/**
 * Canonical section label.
 *
 * Per docs/ui-conventions.md rule 4: `text-[11px] font-medium
 * text-muted-foreground`, sentence case — never `uppercase` + `tracking-*`.
 * Append layout utilities (e.g. `mb-1`) at the call site:
 *
 *   <h4 className={`${SECTION_LABEL} mb-1`}>Scope</h4>
 */
export const SECTION_LABEL = 'text-[11px] font-medium text-muted-foreground';

/**
 * @deprecated The uppercase/tracking eyebrow contradicts ui-conventions rule 4
 * (section labels are sentence case). Use {@link SECTION_LABEL} instead; this
 * alias remains only until the last call sites migrate.
 */
export const EYEBROW = SECTION_LABEL;
