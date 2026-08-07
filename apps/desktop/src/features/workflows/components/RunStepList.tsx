import type { WorkflowDefinition, WorkflowStepRun } from '@zclaudia/shared';
import { WorkflowStepCard } from './WorkflowStepCard';

/**
 * The steps of a run, in the order they actually ran.
 *
 * Deliberately not driven by `buildWorkflowOutline`: the outline describes the
 * workflow as it stands now, and a workflow can be edited after a run. The step
 * records are what happened, so they set the order; the definition is consulted
 * only to put a human name on a step id, and a step it no longer knows about
 * still renders under its id.
 */
export interface RunStepListProps {
  stepRuns: WorkflowStepRun[];
  /** Current definition, used for display names only. */
  definition?: WorkflowDefinition;
  onApprove?: (stepRunId: string) => void;
  onReject?: (stepRunId: string) => void;
  /** Step run currently awaiting an approve/reject response. */
  busyStepRunId?: string | null;
}

export function RunStepList({
  stepRuns,
  definition,
  onApprove,
  onReject,
  busyStepRunId,
}: RunStepListProps) {
  if (stepRuns.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-xs text-muted-foreground">No steps recorded.</p>
    );
  }

  const namesById = new Map((definition?.nodes ?? []).map(n => [n.id, n.name]));

  return (
    <div className="space-y-1.5">
      {stepRuns.map(stepRun => (
        <WorkflowStepCard
          key={stepRun.id}
          name={namesById.get(stepRun.stepId) ?? stepRun.stepId}
          type={stepRun.stepType}
          run={stepRun}
          onApprove={onApprove ? () => onApprove(stepRun.id) : undefined}
          onReject={onReject ? () => onReject(stepRun.id) : undefined}
          busy={busyStepRunId === stepRun.id}
        />
      ))}
    </div>
  );
}
