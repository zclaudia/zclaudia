import { useState } from 'react';
import { ArrowLeft, Loader2, Play, Monitor } from 'lucide-react';
import type { Workflow } from '@zclaudia/shared';
import { normalizeWorkflowDefinition } from '@zclaudia/shared';
import { WorkflowStepList } from './WorkflowStepList';

/**
 * The phone-sized workflow screen.
 *
 * Below `md` the graph editor is not usable — a ~200px drag-to-add palette
 * against a ~175px canvas — and dragging nodes has no touch equivalent, so this
 * view drops authoring entirely and shows the workflow as a list. It is not
 * read-only in the useful sense: running the workflow stays available here,
 * because "trigger it from my phone" is a real thing to want and "rebuild its
 * graph from my phone" is not.
 */
export interface WorkflowMobileViewProps {
  workflow: Workflow;
  onBack: () => void;
  /** Triggers a run. Omit where the caller cannot run this workflow. */
  onRun?: () => Promise<void>;
}

export function WorkflowMobileView({ workflow, onBack, onRun }: WorkflowMobileViewProps) {
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const definition = normalizeWorkflowDefinition(workflow.definition);

  const handleRun = async () => {
    if (!onRun || running) return;
    setRunning(true);
    setRunError(null);
    try {
      await onRun();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Failed to start the workflow');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to workflows"
          className="-m-3 inline-flex shrink-0 items-center p-3 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{workflow.name}</span>
        {onRun && (
          <button
            type="button"
            onClick={handleRun}
            disabled={running}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-muted/60 px-3 py-2 text-xs text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {running ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Play size={12} strokeWidth={2} />
            )}
            Run
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto w-full max-w-[760px] space-y-4">
          {workflow.description && (
            <p className="text-xs text-muted-foreground">{workflow.description}</p>
          )}
          {runError && <p className="text-xs text-destructive">{runError}</p>}

          <WorkflowStepList definition={definition} />

          {/* Say plainly why there is nothing to edit here, rather than leaving
              the reader to wonder where the editor went. */}
          <p className="flex items-start gap-1.5 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
            <Monitor size={12} className="mt-0.5 shrink-0" />
            <span>Editing a workflow needs the graph editor — open this on a larger screen.</span>
          </p>
        </div>
      </div>
    </div>
  );
}
