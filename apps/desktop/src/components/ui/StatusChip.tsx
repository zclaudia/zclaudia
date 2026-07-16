import type { RecordStatus, RecordAvailabilityReason } from '@zclaudia/shared/core/record-status';
import { recordChip } from '@zclaudia/shared/core/record-status';

/** Short labels for the unavailable reasons (also used as the chip's tooltip). */
const REASON_LABEL: Record<RecordAvailabilityReason, string> = {
  no_llm_profile: 'No provider',
  no_credential: 'No credential',
  no_model: 'No model',
  llm_unavailable: 'Provider unavailable',
  unreachable: 'Unreachable',
  needs_auth: 'Needs auth',
  connect_failed: 'Connection failed',
  requirement_unmet: 'Blocked',
};

/** Semantic-token classes per chip category. `ready` renders nothing. */
const CHIP_CLASS: Record<'draft' | 'unavailable' | 'disabled', string> = {
  draft: 'bg-muted text-muted-foreground',
  unavailable: 'bg-warning/10 text-warning',
  disabled: 'bg-muted text-muted-foreground',
};

/**
 * Read-only record-status indicator. Renders nothing for a healthy (`ready`)
 * record so the UI surfaces only drafts and problems. Priority is owned by
 * `recordChip`: Draft → Unavailable → Disabled → Ready.
 */
export function StatusChip({
  status,
  className = '',
}: {
  status: RecordStatus;
  className?: string;
}) {
  const chip = recordChip(status);
  if (chip === 'ready') return null;
  const label =
    chip === 'draft'
      ? 'Draft'
      : chip === 'disabled'
        ? 'Disabled'
        : !status.availability.usable
          ? REASON_LABEL[status.availability.reason]
          : 'Unavailable';
  return (
    <span
      title={label}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ${CHIP_CLASS[chip]} ${className}`.trim()}
    >
      {label}
    </span>
  );
}
