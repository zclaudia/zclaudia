import { useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import type { WorkflowStepRun } from '@zclaudia/shared';
import { getStepIcon } from './nodes/StepNode';
import { StepStatusIcon, formatDuration } from './RunComponents';

/**
 * One step, whether it is being read from a workflow definition or from a run.
 *
 * The two views differ in what they know — a definition has config, a run has a
 * status, a duration and an outcome — but not in how a step should look or
 * behave, so they share this card rather than drifting apart.
 */
export interface WorkflowStepCardProps {
  name: string;
  type: string;
  /** Definition-side: this step routes its failures rather than aborting. */
  onErrorRoute?: boolean;
  /** Definition-side config, as printable pairs. */
  details?: Array<[string, string]>;
  /** Execution-side record. Adds status, duration, output and approval. */
  run?: WorkflowStepRun;
  onApprove?: () => void;
  onReject?: () => void;
  /** True while an approve/reject for this step is in flight. */
  busy?: boolean;
}

export function WorkflowStepCard({
  name,
  type,
  onErrorRoute,
  details = [],
  run,
  onApprove,
  onReject,
  busy,
}: WorkflowStepCardProps) {
  const [open, setOpen] = useState(false);
  const bodyRows = buildBody(details, run);
  const hasBody = bodyRows.length > 0;
  const awaitingDecision = run?.status === 'waiting' && !!onApprove && !!onReject;

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => hasBody && setOpen(v => !v)}
        aria-expanded={hasBody ? open : undefined}
        disabled={!hasBody}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left disabled:cursor-default"
      >
        <span className="shrink-0 text-muted-foreground">
          {run ? <StepStatusIcon status={run.status} /> : getStepIcon(type)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{name}</span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
            {type}
          </span>
        </span>
        {run?.startedAt && (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {formatDuration(run.startedAt, run.completedAt)}
          </span>
        )}
        {onErrorRoute && !run && (
          <span className="shrink-0 rounded-full bg-warning/15 px-1.5 py-0.5 text-[9px] text-warning">
            error route
          </span>
        )}
        {hasBody && (
          <ChevronRight
            size={14}
            aria-hidden="true"
            className={`shrink-0 text-muted-foreground/70 transition-transform ${open ? 'rotate-90' : ''}`}
          />
        )}
      </button>

      {awaitingDecision && (
        <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2">
          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-success px-3 py-2 text-xs font-medium text-success-foreground transition-colors hover:bg-success/90 disabled:opacity-50"
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            Approve
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={busy}
            className="flex-1 rounded-md bg-destructive px-3 py-2 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}

      {open && (
        <dl className="space-y-1.5 border-t border-border/60 px-3 py-2">
          {bodyRows.map(([key, value, tone]) => (
            <div key={key}>
              <dt className="text-[10px] text-muted-foreground">{key}</dt>
              {/* Prompts, shell commands and step output all carry newlines, so
                  values wrap instead of being clipped to a line. */}
              <dd
                className={`whitespace-pre-wrap break-words font-mono text-[11px] ${
                  tone === 'error' ? 'text-destructive' : 'text-foreground'
                }`}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

type BodyRow = [key: string, value: string, tone?: 'error'];

function buildBody(details: Array<[string, string]>, run?: WorkflowStepRun): BodyRow[] {
  const rows: BodyRow[] = details.map(([k, v]) => [k, v]);
  if (!run) return rows;
  if (run.error) rows.push(['error', run.error, 'error']);
  if (run.output && Object.keys(run.output).length > 0) {
    rows.push(['output', JSON.stringify(run.output, null, 2)]);
  }
  if (run.sessionId) rows.push(['session', run.sessionId]);
  if (run.attempt > 1) rows.push(['attempt', String(run.attempt)]);
  return rows;
}
