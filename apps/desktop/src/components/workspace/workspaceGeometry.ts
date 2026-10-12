import type { LayoutNode, PaneNode, SplitDir } from '../../stores/rightWorkspaceStore';

export interface Size {
  width: number;
  height: number;
}

/** Coordinates are relative to the workspace canvas, before viewport scrolling. */
export interface WorkspaceRect extends Size {
  left: number;
  top: number;
}

export const WORKSPACE_GUTTER = 8;
// Chat: header 48 + composer 152 + transcript 120. Tool: header 40 + content 120.
// These are usable lower bounds, not preferred/default card dimensions.
export const CHAT_MIN_SIZE: Readonly<Size> = { width: 360, height: 320 };
export const TOOL_MIN_SIZE: Readonly<Size> = { width: 240, height: 160 };

export interface GroupGeometry {
  rect: WorkspaceRect;
  /** Available child pixels on this group's split axis, excluding its gutter. */
  axisSize: number;
  minRatio: number;
  maxRatio: number;
  /** Effective ratio, clamped for this viewport without mutating the layout tree. */
  ratio: number;
}

export interface DividerGeometry extends GroupGeometry {
  groupId: string;
  dir: SplitDir;
  /** The divider's rectangle (the group's rectangle is available in groups). */
  rect: WorkspaceRect;
}

export interface WorkspaceGeometry extends Size {
  minimum: Size;
  panes: Map<string, WorkspaceRect>;
  groups: Map<string, GroupGeometry>;
  dividers: DividerGeometry[];
}

/** Tree order for geometry; rendering may keep a separate, stable host order. */
export function flattenPanes(root: LayoutNode | null): PaneNode[] {
  if (!root) return [];
  if (root.kind === 'placeholder') return [];
  return root.kind === 'pane' ? [root] : root.children.flatMap(child => flattenPanes(child));
}

export function minimumWorkspaceSize(root: LayoutNode | null): Size {
  if (!root) return { width: 0, height: 0 };
  if (root.kind === 'placeholder') {
    return { ...(root.accepts === 'chat' ? CHAT_MIN_SIZE : TOOL_MIN_SIZE) };
  }
  if (root.kind === 'pane') {
    return { ...(root.tools.some(ref => ref.toolId === 'chat') ? CHAT_MIN_SIZE : TOOL_MIN_SIZE) };
  }
  const [a, b] = root.children.map(minimumWorkspaceSize);
  return root.dir === 'row'
    ? { width: a.width + b.width + WORKSPACE_GUTTER, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: a.height + b.height + WORKSPACE_GUTTER };
}

export function clampGeometryRatio(
  ratio: number,
  group: Pick<GroupGeometry, 'minRatio' | 'maxRatio'>
): number {
  return Math.max(group.minRatio, Math.min(group.maxRatio, Number.isFinite(ratio) ? ratio : 0.5));
}

/**
 * Layout a visible projection of the tree on a canvas large enough for all leaf
 * minima. Nested dividers use their local available axis, never the root size.
 * The stored ratios are intentionally untouched when the viewport changes.
 */
export function solveWorkspaceGeometry(root: LayoutNode | null, viewport: Size): WorkspaceGeometry {
  const minimum = minimumWorkspaceSize(root);
  const result: WorkspaceGeometry = {
    width: Math.max(minimum.width, Number.isFinite(viewport.width) ? viewport.width : 0),
    height: Math.max(minimum.height, Number.isFinite(viewport.height) ? viewport.height : 0),
    minimum,
    panes: new Map(),
    groups: new Map(),
    dividers: [],
  };
  if (!root) return result;

  const visit = (node: LayoutNode, rect: WorkspaceRect) => {
    if (node.kind !== 'group') {
      result.panes.set(node.id, rect);
      return;
    }
    const row = node.dir === 'row';
    const axis = row ? 'width' : 'height';
    const axisSize = rect[axis] - WORKSPACE_GUTTER;
    const [aMin, bMin] = node.children.map(minimumWorkspaceSize);
    const minRatio = aMin[axis] / axisSize;
    const maxRatio = 1 - bMin[axis] / axisSize;
    const ratio = clampGeometryRatio(node.ratio, { minRatio, maxRatio });
    const group: GroupGeometry = { rect, axisSize, minRatio, maxRatio, ratio };
    result.groups.set(node.id, group);
    const firstSize = axisSize * ratio;
    const first = { ...rect, [axis]: firstSize };
    const divider = row
      ? { left: rect.left + firstSize, top: rect.top, width: WORKSPACE_GUTTER, height: rect.height }
      : { left: rect.left, top: rect.top + firstSize, width: rect.width, height: WORKSPACE_GUTTER };
    const second = row
      ? { ...rect, left: divider.left + WORKSPACE_GUTTER, width: axisSize - firstSize }
      : { ...rect, top: divider.top + WORKSPACE_GUTTER, height: axisSize - firstSize };
    result.dividers.push({ ...group, groupId: node.id, dir: node.dir, rect: divider });
    visit(node.children[0], first);
    visit(node.children[1], second);
  };
  visit(root, { left: 0, top: 0, width: result.width, height: result.height });
  return result;
}
