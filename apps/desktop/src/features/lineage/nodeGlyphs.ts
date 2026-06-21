import type { GraphNode } from '@zclaudia/shared';

export type GlyphShape = 'dot' | 'square' | 'branch' | 'tag' | 'leaf' | 'tip';
export interface Glyph { shape: GlyphShape; ring: boolean; dimmed: boolean; }

/** Priority order resolves co-occurring roles to a single primary shape. */
export function glyphFor(n: GraphNode): Glyph {
  const ring = n.isForkPoint;
  const dimmed = n.isBranchTip && !n.onActivePath;
  let shape: GlyphShape = 'dot';
  if (n.entryType === 'compaction') shape = 'square';
  else if (n.entryType === 'label') shape = 'tag';
  else if (n.isActiveLeaf) shape = 'leaf';
  else if (n.isBranchTip && !n.onActivePath) shape = 'tip';
  else if (n.isBranchPoint) shape = 'branch';
  else if (n.isRoot) shape = 'dot';
  return { shape, ring, dimmed };
}

/** Lane palette: chart tokens tuned for the default light theme; cycles by laneOrder. */
export const LANE_PALETTE = [
  'hsl(var(--primary))',
  'hsl(var(--thinking))',
  'hsl(var(--success))',
  'hsl(var(--warning))',
] as const;

export function laneColor(laneOrder: number): string {
  return LANE_PALETTE[((laneOrder % LANE_PALETTE.length) + LANE_PALETTE.length) % LANE_PALETTE.length];
}
