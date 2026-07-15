import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import type { WorkflowEdgeType } from '@zclaudia/shared';

const EDGE_STYLES: Record<
  WorkflowEdgeType,
  {
    stroke: string;
    strokeDasharray?: string;
    label: string;
    labelColor: string;
  }
> = {
  // Token-driven so strokes/labels adapt across themes instead of shipping fixed
  // hex (the amber loop label was low-contrast on the dark flow canvas).
  success: { stroke: 'hsl(var(--muted-foreground) / 0.4)', label: '', labelColor: '' },
  error: {
    stroke: 'hsl(var(--destructive))',
    strokeDasharray: '5,5',
    label: 'Error',
    labelColor: 'hsl(var(--destructive))',
  },
  condition_true: {
    stroke: 'hsl(var(--success))',
    label: 'True',
    labelColor: 'hsl(var(--success))',
  },
  condition_false: {
    stroke: 'hsl(var(--destructive))',
    label: 'False',
    labelColor: 'hsl(var(--destructive))',
  },
  loop: {
    stroke: 'hsl(var(--warning))',
    strokeDasharray: '6,4',
    label: 'Loop',
    labelColor: 'hsl(var(--warning))',
  },
  loop_exhausted: {
    stroke: 'hsl(var(--destructive))',
    strokeDasharray: '3,3',
    label: 'Loop Exhausted',
    labelColor: 'hsl(var(--destructive))',
  },
};

export const WorkflowEdge = memo(function WorkflowEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected } =
    props;

  const edgeType = (data?.edgeType as WorkflowEdgeType) ?? 'success';
  const style = EDGE_STYLES[edgeType] ?? EDGE_STYLES.success;
  const maxIterations = typeof data?.maxIterations === 'number' ? data.maxIterations : undefined;
  const edgeLabel =
    edgeType === 'loop' && maxIterations ? `${style.label} x${maxIterations}` : style.label;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? 'hsl(var(--primary))' : style.stroke,
          strokeWidth: selected ? 2.5 : 2,
          strokeDasharray: style.strokeDasharray,
        }}
      />
      {edgeLabel && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-card border border-border"
          >
            <span style={{ color: style.labelColor }}>{edgeLabel}</span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
