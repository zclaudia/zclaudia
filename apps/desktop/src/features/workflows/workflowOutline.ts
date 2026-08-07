import type { WorkflowDefinition, WorkflowEdgeDef, WorkflowNodeDef } from '@zclaudia/shared';

/**
 * Flattens a workflow graph into the reading order a phone can show.
 *
 * The canvas is unusable below `md` (a ~200px palette against a ~175px canvas,
 * nodes clipped on both edges), so mobile reads the workflow as an indented
 * list instead. A DAG does not always survive that: anywhere two branches join
 * back together the list has to reference a step rather than repeat it, and
 * `faithful` goes false so the view can say so instead of pretending.
 */

export interface WorkflowOutlineStep {
  kind: 'step';
  node: WorkflowNodeDef;
  /** Indent level; branch targets sit one level deeper than their source. */
  depth: number;
  /** How this step was reached — absent for a plain success edge. */
  via?: string;
}

/** A branch that rejoins a step already listed above. */
export interface WorkflowOutlineJoin {
  kind: 'join';
  targetId: string;
  targetName: string;
  depth: number;
  via?: string;
}

export type WorkflowOutlineRow = WorkflowOutlineStep | WorkflowOutlineJoin;

export interface WorkflowOutline {
  rows: WorkflowOutlineRow[];
  /** Nodes the entry step cannot reach. Listed separately rather than dropped. */
  orphans: WorkflowNodeDef[];
  /** False when the graph could not be listed without a back-reference. */
  faithful: boolean;
}

/** Reading order for a step's outgoing edges: the happy path first. */
const EDGE_ORDER: Record<WorkflowEdgeDef['type'], number> = {
  success: 0,
  condition_true: 1,
  condition_false: 2,
  error: 3,
  loop: 4,
  loop_exhausted: 5,
};

const EDGE_LABEL: Record<WorkflowEdgeDef['type'], string | undefined> = {
  success: undefined,
  condition_true: 'if true',
  condition_false: 'if false',
  error: 'on error',
  loop: 'loop',
  loop_exhausted: 'loop exhausted',
};

export function edgeLabel(edge: WorkflowEdgeDef): string | undefined {
  return edge.label || EDGE_LABEL[edge.type];
}

/** Success continues the current column; every other edge is a branch. */
function isBranch(edge: WorkflowEdgeDef): boolean {
  return edge.type !== 'success';
}

function resolveEntryId(definition: WorkflowDefinition): string | undefined {
  const { nodes, edges, entryNodeId } = definition;
  if (entryNodeId && nodes.some(n => n.id === entryNodeId)) return entryNodeId;
  const targeted = new Set(edges.map(e => e.target));
  return (nodes.find(n => !targeted.has(n.id)) ?? nodes[0])?.id;
}

export function buildWorkflowOutline(definition: WorkflowDefinition): WorkflowOutline {
  const byId = new Map(definition.nodes.map(n => [n.id, n]));
  const outgoing = new Map<string, WorkflowEdgeDef[]>();
  for (const edge of definition.edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    const list = outgoing.get(edge.source);
    if (list) list.push(edge);
    else outgoing.set(edge.source, [edge]);
  }
  for (const list of outgoing.values()) {
    list.sort((a, b) => EDGE_ORDER[a.type] - EDGE_ORDER[b.type]);
  }

  const rows: WorkflowOutlineRow[] = [];
  const visited = new Set<string>();
  let faithful = true;

  const entryId = resolveEntryId(definition);

  // Explicit stack so the walk stays depth-first in edge order without
  // recursing over a user-supplied graph.
  const stack: Array<{ id: string; depth: number; via?: string }> = entryId
    ? [{ id: entryId, depth: 0 }]
    : [];

  while (stack.length > 0) {
    const { id, depth, via } = stack.pop()!;
    const node = byId.get(id);
    if (!node) continue;

    if (visited.has(id)) {
      // Two paths converge here. The list can only point back at it.
      rows.push({ kind: 'join', targetId: id, targetName: node.name, depth, via });
      faithful = false;
      continue;
    }

    visited.add(id);
    rows.push({ kind: 'step', node, depth, via });

    const next = outgoing.get(id) ?? [];
    // Pushed in reverse so the first edge is popped first.
    for (let i = next.length - 1; i >= 0; i -= 1) {
      const edge = next[i];
      stack.push({
        id: edge.target,
        depth: isBranch(edge) ? depth + 1 : depth,
        via: edgeLabel(edge),
      });
    }
  }

  const orphans = definition.nodes.filter(n => !visited.has(n.id));
  return { rows, orphans, faithful };
}
