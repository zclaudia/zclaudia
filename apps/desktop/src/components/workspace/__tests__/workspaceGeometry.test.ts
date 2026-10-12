import { describe, expect, it } from 'vitest';
import { newPane, type GroupNode, type LayoutNode } from '../../../stores/rightWorkspaceStore';
import {
  CHAT_MIN_SIZE,
  TOOL_MIN_SIZE,
  flattenPanes,
  minimumWorkspaceSize,
  solveWorkspaceGeometry,
  clampGeometryRatio,
} from '../workspaceGeometry';

const pane = (id: string, toolId = 'draft') => ({
  ...newPane(toolId, toolId === 'chat' ? id : undefined),
  id,
});
const group = (
  id: string,
  dir: GroupNode['dir'],
  a: LayoutNode,
  b: LayoutNode,
  ratio = 0.5
): GroupNode => ({ id, kind: 'group', dir, ratio, children: [a, b] });

// Three mixed levels: chat | (memory / (draft | terminal)).
const mixed = () =>
  group(
    'outer',
    'row',
    pane('chat', 'chat'),
    group('stack', 'col', pane('memory'), group('inner', 'row', pane('draft'), pane('terminal')))
  );

describe('workspace geometry', () => {
  it('lays out independent chat/tool placeholders without inventing pane refs', () => {
    const tree = group(
      'g',
      'row',
      { id: 'chat-slot', kind: 'placeholder', slotId: 'chat-2', accepts: 'chat' },
      { id: 'tool-slot', kind: 'placeholder', slotId: 'files', accepts: 'tool:file-viewer' }
    );
    expect(flattenPanes(tree)).toEqual([]);
    expect(minimumWorkspaceSize(tree)).toEqual({ width: 608, height: 320 });
    const solved = solveWorkspaceGeometry(tree, { width: 100, height: 100 });
    expect(solved.panes.get('chat-slot')).toEqual({ left: 0, top: 0, width: 360, height: 320 });
    expect(solved.panes.get('tool-slot')).toEqual({ left: 368, top: 0, width: 240, height: 320 });
  });

  it('handles an empty workspace and a chat-only visible projection', () => {
    expect(flattenPanes(null)).toEqual([]);
    expect(minimumWorkspaceSize(null)).toEqual({ width: 0, height: 0 });
    const onlyChat = solveWorkspaceGeometry(pane('chat', 'chat'), { width: 200, height: 100 });
    expect(onlyChat.minimum).toEqual(CHAT_MIN_SIZE);
    expect(onlyChat.panes.get('chat')).toEqual({ left: 0, top: 0, ...CHAT_MIN_SIZE });
    expect(onlyChat.dividers).toHaveLength(0);
  });

  it('aggregates recursive row and column minima including each gutter', () => {
    expect(minimumWorkspaceSize(mixed())).toEqual({ width: 856, height: 328 });
    expect(flattenPanes(mixed()).map(p => p.id)).toEqual(['chat', 'memory', 'draft', 'terminal']);
    expect(minimumWorkspaceSize(group('stack', 'col', pane('a'), pane('b')))).toEqual({
      width: TOOL_MIN_SIZE.width,
      height: TOOL_MIN_SIZE.height * 2 + 8,
    });
  });

  it('uses a nested group axis minus its own gutter, with contiguous pane rectangles', () => {
    const layout = solveWorkspaceGeometry(mixed(), { width: 1200, height: 800 });
    const outer = layout.groups.get('outer')!;
    const inner = layout.groups.get('inner')!;
    expect(outer.axisSize).toBe(1192);
    expect(inner.rect).toEqual({ left: 604, top: 404, width: 596, height: 396 });
    expect(inner.axisSize).toBe(588);
    const divider = layout.dividers.find(d => d.groupId === 'inner')!;
    expect(divider.rect).toEqual({ left: 898, top: 404, width: 8, height: 396 });
    expect(layout.panes.get('draft')!.left + layout.panes.get('draft')!.width).toBe(
      divider.rect.left
    );
    expect(layout.panes.get('terminal')!.left).toBe(divider.rect.left + 8);
    // 59px movement is ten percent locally; it would be only five percent at root.
    expect(58.8 / inner.axisSize).toBeCloseTo(0.1);
  });

  it('expands an undersized viewport and clamps every child subtree without overwriting ratios', () => {
    const tree = mixed();
    tree.ratio = 0.1;
    const serialized = JSON.stringify(tree);
    const small = solveWorkspaceGeometry(tree, { width: 100, height: 100 });
    expect(small.width).toBe(856);
    expect(small.height).toBe(328);
    for (const [id, rect] of small.panes) {
      const minimum = id === 'chat' ? CHAT_MIN_SIZE : TOOL_MIN_SIZE;
      expect(rect.width).toBeGreaterThanOrEqual(minimum.width - 1e-10);
      expect(rect.height).toBeGreaterThanOrEqual(minimum.height - 1e-10);
    }
    expect(small.groups.get('outer')!.ratio).toBeCloseTo(360 / 848);
    const resized = solveWorkspaceGeometry(tree, { width: 5000, height: 1000 });
    expect(resized.groups.get('outer')!.ratio).toBe(0.1);
    expect(JSON.stringify(tree)).toBe(serialized);
  });

  it('bounds extreme ratios by both subtrees on both split axes', () => {
    for (const dir of ['row', 'col'] as const) {
      for (const ratio of [-100, 100, Number.NaN]) {
        const layout = solveWorkspaceGeometry(
          group('g', dir, pane('chat', 'chat'), pane('tool'), ratio),
          { width: 1000, height: 700 }
        );
        const g = layout.groups.get('g')!;
        expect(g.ratio).toBeGreaterThanOrEqual(g.minRatio);
        expect(g.ratio).toBeLessThanOrEqual(g.maxRatio);
        expect(layout.panes.get('chat')!.width).toBeGreaterThanOrEqual(360 - 1e-10);
        expect(layout.panes.get('chat')!.height).toBeGreaterThanOrEqual(320 - 1e-10);
        expect(clampGeometryRatio(-1, g)).toBe(g.minRatio);
        expect(clampGeometryRatio(2, g)).toBe(g.maxRatio);
      }
    }
  });
});
