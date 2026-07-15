/**
 * Unified per-record status for the four Agents-library record types
 * (agent profile, LLM profile, MCP server, skill). Two independent facets —
 * intrinsic completeness and extrinsic availability — plus an optional user
 * disable toggle, collapsed to a single priority-ordered display chip.
 *
 * See docs/specs/2026-07-15-unified-record-status-design.md.
 */

/** Why a complete record is not currently usable (a dependency/precondition failed). */
export type RecordAvailabilityReason =
  | 'no_llm_profile'
  | 'no_credential'
  | 'no_model'
  | 'llm_unavailable'
  | 'unreachable'
  | 'needs_auth'
  | 'connect_failed'
  | 'requirement_unmet';

/** Intrinsic: are the record's OWN required fields present? */
export type RecordCompleteness = 'ready' | 'draft';

/** Extrinsic: are the record's dependencies/preconditions satisfied? */
export type RecordAvailability =
  | { usable: true }
  | { usable: false; reason: RecordAvailabilityReason };

export interface RecordStatus {
  completeness: RecordCompleteness;
  availability: RecordAvailability;
  /** User toggle (e.g. MCP enabled=false). Absent = not disabled. */
  disabled?: boolean;
}

/** The single label to display. Priority: Draft → Unavailable → Disabled → Ready. */
export type RecordChip = 'draft' | 'unavailable' | 'disabled' | 'ready';

export function recordChip(status: RecordStatus): RecordChip {
  if (status.completeness === 'draft') return 'draft';
  if (!status.availability.usable) return 'unavailable';
  if (status.disabled) return 'disabled';
  return 'ready';
}
