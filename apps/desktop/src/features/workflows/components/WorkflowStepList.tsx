import { useState } from 'react';
import { ChevronRight, CornerDownRight, AlertTriangle, RotateCcw } from 'lucide-react';
import type { WorkflowDefinition, WorkflowNodeDef } from '@zclaudia/shared';
import { buildWorkflowOutline, type WorkflowOutlineRow } from '../workflowOutline';
import { getStepIcon } from './nodes/StepNode';
import { SECTION_LABEL } from '../../../components/ui/typography';

/**
 * A workflow read as an indented list rather than drawn as a graph.
 *
 * This is what mobile gets instead of the canvas. It is deliberately not
 * editable — authoring by dragging nodes has no touch equivalent — but it is
 * not inert either: the caller supplies whatever actions apply (run, cancel,
 * approve) around it.
 */
export function WorkflowStepList({ definition }: { definition: WorkflowDefinition }) {
  const outline = buildWorkflowOutline(definition);

  if (outline.rows.length === 0 && outline.orphans.length === 0) {
    return <p className="px-1 py-6 text-center text-xs text-muted-foreground">No steps defined.</p>;
  }

  return (
    <div className="space-y-1.5">
      {outline.rows.map((row, index) => (
        <OutlineRow key={rowKey(row, index)} row={row} />
      ))}

      {outline.orphans.length > 0 && (
        <div className="pt-3">
          <h4 className={`${SECTION_LABEL} mb-1.5`}>Not connected</h4>
          <div className="space-y-1.5">
            {outline.orphans.map(node => (
              <StepCard key={node.id} node={node} />
            ))}
          </div>
        </div>
      )}

      {!outline.faithful && (
        <p className="flex items-start gap-1.5 pt-3 text-[11px] text-muted-foreground">
          <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warning" />
          <span>
            Branches in this workflow rejoin each other, which a list can only point back at. Open
            it on a larger screen to see the full graph.
          </span>
        </p>
      )}
    </div>
  );
}

function rowKey(row: WorkflowOutlineRow, index: number): string {
  return row.kind === 'step' ? `s:${row.node.id}:${index}` : `j:${row.targetId}:${index}`;
}

/** Indent is capped so a deeply branched workflow keeps a readable card width. */
const INDENT_REM = [0, 0.75, 1.5, 2] as const;

function indentStyle(depth: number) {
  return { marginLeft: `${INDENT_REM[Math.min(depth, INDENT_REM.length - 1)]}rem` };
}

function OutlineRow({ row }: { row: WorkflowOutlineRow }) {
  if (row.kind === 'join') {
    return (
      <div style={indentStyle(row.depth)}>
        {row.via && <BranchLabel label={row.via} />}
        <div className="flex items-center gap-1.5 rounded-md border border-dashed border-border/70 px-3 py-2 text-[11px] text-muted-foreground">
          <RotateCcw size={12} className="shrink-0" />
          {/* One text node so the sentence stays greppable in tests and to
              screen readers rather than being split around the name. */}
          <span className="min-w-0 truncate">{`Continues at “${row.targetName}”`}</span>
        </div>
      </div>
    );
  }
  return (
    <div style={indentStyle(row.depth)}>
      {row.via && <BranchLabel label={row.via} />}
      <StepCard node={row.node} />
    </div>
  );
}

function BranchLabel({ label }: { label: string }) {
  return (
    <div className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground">
      <CornerDownRight size={11} className="shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}

function StepCard({ node }: { node: WorkflowNodeDef }) {
  const [open, setOpen] = useState(false);
  const entries = configEntries(node);
  const hasDetail = entries.length > 0;

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => hasDetail && setOpen(v => !v)}
        aria-expanded={hasDetail ? open : undefined}
        disabled={!hasDetail}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left disabled:cursor-default"
      >
        <span className="shrink-0 text-muted-foreground">{getStepIcon(node.type)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{node.name}</span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
            {node.type}
          </span>
        </span>
        {node.onError === 'route' && (
          <span className="shrink-0 rounded-full bg-warning/15 px-1.5 py-0.5 text-[9px] text-warning">
            error route
          </span>
        )}
        {hasDetail && (
          <ChevronRight
            size={14}
            aria-hidden="true"
            className={`shrink-0 text-muted-foreground/70 transition-transform ${open ? 'rotate-90' : ''}`}
          />
        )}
      </button>

      {open && (
        <dl className="space-y-1.5 border-t border-border/60 px-3 py-2">
          {entries.map(([key, value]) => (
            <div key={key}>
              <dt className="text-[10px] text-muted-foreground">{key}</dt>
              {/* Prompts and shell commands run long and carry newlines, so the
                  value wraps instead of being clipped to one line. */}
              <dd className="whitespace-pre-wrap break-words font-mono text-[11px] text-foreground">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** Config plus the execution settings worth reading, as printable pairs. */
function configEntries(node: WorkflowNodeDef): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  if (node.condition?.expression) entries.push(['condition', node.condition.expression]);
  for (const [key, value] of Object.entries(node.config ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    entries.push([key, typeof value === 'string' ? value : JSON.stringify(value, null, 2)]);
  }
  if (node.onError) entries.push(['on error', node.onError]);
  if (typeof node.retryCount === 'number') entries.push(['retries', String(node.retryCount)]);
  if (typeof node.timeoutMs === 'number') entries.push(['timeout', `${node.timeoutMs} ms`]);
  return entries;
}
