// apps/desktop/src/features/openspec/components/StatusBadge.tsx
//
// Small reusable badge for issue + executor + spec-change statuses. Colors
// come from the shared semantic tone map (ui-conventions rule 1).

import React from 'react';
import type { LocalIssue, LocalIssueStatus } from '@zclaudia/shared/features/local-issue';
import type { ExecutorStatus } from '@zclaudia/shared/features/executor';
import type { SpecChangeStatus } from '@zclaudia/shared/features/spec-change';
import { TONE_BADGE, type Tone } from '../../../components/ui/tone.js';
import { useOpenSpecStore } from '../store.js';

const STATUS_TONES: Record<string, Tone> = {
  // LocalIssue (4 lifecycle states)
  open: 'neutral',
  tracked: 'info',
  closed: 'success',
  cancelled: 'destructive',
  // SpecChange (full workflow — projected via IssueStatusBadge)
  drafting: 'neutral',
  proposing: 'info',
  designing: 'info',
  tasks_ready: 'info',
  archived: 'success',
  // Executor
  pending: 'neutral',
  executing: 'success',
  paused: 'warning',
  completed: 'success',
  failed: 'destructive',
};

export function StatusBadge({
  status,
}: {
  status: LocalIssueStatus | ExecutorStatus | SpecChangeStatus;
}): React.ReactElement {
  const cls = TONE_BADGE[STATUS_TONES[status] ?? 'neutral'];
  return <span className={`px-2 py-0.5 rounded-md text-xs font-mono ${cls}`}>{status}</span>;
}

/**
 * Renders an Issue's status with workflow-state projection:
 * - If the issue has a `specChangeId` and the SpecChange is loaded, show the
 *   SpecChange's status (the real workflow state).
 * - Otherwise, fall back to the issue's own lifecycle status.
 *
 * Feature-issues never carry a SpecChange, so they naturally fall back to
 * their own `open/closed/cancelled` lifecycle.
 */
export function IssueStatusBadge({ issue }: { issue: LocalIssue }): React.ReactElement {
  const specChange = useOpenSpecStore(s =>
    issue.specChangeId ? s.specChangesById[issue.specChangeId] : undefined
  );
  const status: LocalIssueStatus | SpecChangeStatus = specChange ? specChange.status : issue.status;
  return <StatusBadge status={status} />;
}
