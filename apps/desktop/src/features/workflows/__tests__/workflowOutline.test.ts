import { describe, it, expect } from 'vitest';
import type { WorkflowDefinition, WorkflowEdgeDef, WorkflowNodeDef } from '@zclaudia/shared';
import { buildWorkflowOutline, edgeLabel } from '../workflowOutline';

function node(id: string, name = id): WorkflowNodeDef {
  return { id, name, type: 'shell', config: {}, position: { x: 0, y: 0 } };
}
function edge(source: string, target: string, type: WorkflowEdgeDef['type'] = 'success') {
  return { id: `${source}->${target}:${type}`, source, target, type };
}
function def(
  nodes: WorkflowNodeDef[],
  edges: WorkflowEdgeDef[],
  entryNodeId = nodes[0]?.id ?? ''
): WorkflowDefinition {
  return { nodes, edges, entryNodeId };
}

const stepIds = (rows: ReturnType<typeof buildWorkflowOutline>['rows']) =>
  rows.filter(r => r.kind === 'step').map(r => (r as { node: WorkflowNodeDef }).node.id);

describe('buildWorkflowOutline', () => {
  it('lists a linear workflow in order at one depth', () => {
    const outline = buildWorkflowOutline(
      def([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c')])
    );
    expect(stepIds(outline.rows)).toEqual(['a', 'b', 'c']);
    expect(outline.rows.every(r => r.depth === 0)).toBe(true);
    expect(outline.faithful).toBe(true);
    expect(outline.orphans).toEqual([]);
  });

  it('indents branch targets and labels how they were reached', () => {
    const outline = buildWorkflowOutline(
      def(
        [node('run'), node('ok'), node('fix')],
        [edge('run', 'ok'), edge('run', 'fix', 'error')]
      )
    );
    const [first, second, third] = outline.rows;
    expect(first).toMatchObject({ depth: 0, via: undefined });
    // Success continues the column; the error branch steps in one level.
    expect(second).toMatchObject({ depth: 0, via: undefined });
    expect(third).toMatchObject({ depth: 1, via: 'on error' });
    expect(stepIds(outline.rows)).toEqual(['run', 'ok', 'fix']);
  });

  it('walks the happy path before the branches', () => {
    const outline = buildWorkflowOutline(
      def(
        [node('cond'), node('yes'), node('no')],
        [edge('cond', 'no', 'condition_false'), edge('cond', 'yes', 'condition_true')]
      )
    );
    // Declaration order is irrelevant — true reads before false.
    expect(stepIds(outline.rows)).toEqual(['cond', 'yes', 'no']);
    expect(outline.rows[1]).toMatchObject({ via: 'if true' });
    expect(outline.rows[2]).toMatchObject({ via: 'if false' });
  });

  it('references a rejoined step instead of repeating it, and says it is lossy', () => {
    const outline = buildWorkflowOutline(
      def(
        [node('cond'), node('yes'), node('no'), node('end')],
        [
          edge('cond', 'yes', 'condition_true'),
          edge('cond', 'no', 'condition_false'),
          edge('yes', 'end'),
          edge('no', 'end'),
        ]
      )
    );
    // `end` is listed once; the second arrival points back at it.
    expect(stepIds(outline.rows)).toEqual(['cond', 'yes', 'end', 'no']);
    const join = outline.rows.find(r => r.kind === 'join');
    expect(join).toMatchObject({ targetId: 'end', targetName: 'end' });
    expect(outline.faithful).toBe(false);
  });

  it('reports nodes the entry cannot reach instead of dropping them', () => {
    const outline = buildWorkflowOutline(def([node('a'), node('stray')], [], 'a'));
    expect(stepIds(outline.rows)).toEqual(['a']);
    expect(outline.orphans.map(n => n.id)).toEqual(['stray']);
  });

  it('falls back to the node nothing points at when entryNodeId is unusable', () => {
    const outline = buildWorkflowOutline(def([node('b'), node('a')], [edge('a', 'b')], 'gone'));
    expect(stepIds(outline.rows)).toEqual(['a', 'b']);
  });

  it('terminates on a cycle', () => {
    const outline = buildWorkflowOutline(
      def([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a', 'loop')])
    );
    expect(stepIds(outline.rows)).toEqual(['a', 'b']);
    expect(outline.faithful).toBe(false);
  });

  it('ignores edges pointing at nodes that no longer exist', () => {
    const outline = buildWorkflowOutline(def([node('a')], [edge('a', 'deleted')]));
    expect(stepIds(outline.rows)).toEqual(['a']);
    expect(outline.faithful).toBe(true);
  });

  it('handles an empty definition', () => {
    const outline = buildWorkflowOutline({ nodes: [], edges: [], entryNodeId: '' });
    expect(outline.rows).toEqual([]);
    expect(outline.orphans).toEqual([]);
    expect(outline.faithful).toBe(true);
  });
});

describe('edgeLabel', () => {
  it('prefers an author-supplied label', () => {
    expect(edgeLabel({ id: 'e', source: 'a', target: 'b', type: 'error', label: 'timed out' })).toBe(
      'timed out'
    );
  });

  it('leaves a plain success edge unlabelled', () => {
    expect(edgeLabel({ id: 'e', source: 'a', target: 'b', type: 'success' })).toBeUndefined();
  });
});
