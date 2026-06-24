import { describe, it, expect } from 'vitest';
import {
  resolveDropZone,
  dropZoneToDir,
  canDrop,
  disabledZones,
  type Rect,
} from '../dragSplit';
import type { LayoutNode, PaneNode, GroupNode } from '../../../stores/splitLayoutStore';

const R: Rect = { left: 0, top: 0, width: 100, height: 100 };
const cx = 50, cy = 50;

const pane = (id: string, panelId: string, instanceKey?: string): PaneNode => ({
  id, kind: 'pane', panelId, ...(instanceKey !== undefined ? { instanceKey } : {}),
});

describe('resolveDropZone', () => {
  it('returns center inside the deadzone', () => {
    expect(resolveDropZone(R, cx, cy)).toBe('center');
    // Inside the 40%×40% deadzone (halfDead = 0.2 → ±10px on a 100px pane).
    expect(resolveDropZone(R, cx + 8, cy)).toBe('center');
    expect(resolveDropZone(R, cx, cy - 8)).toBe('center');
  });

  it('returns left/right by the more-extreme axis', () => {
    expect(resolveDropZone(R, 0, cy)).toBe('left'); // far left edge
    expect(resolveDropZone(R, 100, cy)).toBe('right'); // far right edge
    expect(resolveDropZone(R, 10, cy)).toBe('left');
  });

  it('returns top/bottom by the more-extreme axis', () => {
    expect(resolveDropZone(R, cx, 0)).toBe('top');
    expect(resolveDropZone(R, cx, 100)).toBe('bottom');
  });

  it('classifies corners by the dominant axis', () => {
    // top-left corner: dx=-1, dy=-1 equal → dx wins → left
    expect(resolveDropZone(R, 0, 0)).toBe('left');
    // a point clearly above more than left of center → top
    expect(resolveDropZone(R, cx - 10, 0)).toBe('top');
  });
});

describe('dropZoneToDir', () => {
  it('maps edges to row/col + insertFirst', () => {
    expect(dropZoneToDir('left')).toEqual({ dir: 'row', insertFirst: true });
    expect(dropZoneToDir('right')).toEqual({ dir: 'row', insertFirst: false });
    expect(dropZoneToDir('top')).toEqual({ dir: 'col', insertFirst: true });
    expect(dropZoneToDir('bottom')).toEqual({ dir: 'col', insertFirst: false });
    expect(dropZoneToDir('center')).toBeNull();
  });
});

describe('canDrop', () => {
  it('allows replacing a pane with a non-conflicting panel (center)', () => {
    const root: LayoutNode = pane('p1', 'draft');
    expect(canDrop(root, 'p1', 'center', { panelId: 'memory' }).allowed).toBe(true);
  });

  it('allows replacing a pane with the SAME panel (center excludes the target)', () => {
    const root: LayoutNode = pane('p1', 'draft');
    // Replacing p1 with draft is fine (it's the same pane).
    expect(canDrop(root, 'p1', 'center', { panelId: 'draft' }).allowed).toBe(true);
  });

  it('forbids splitting to add a singleton already present (edge)', () => {
    const root: LayoutNode = pane('p1', 'draft');
    // Adding draft beside p1 (any edge) conflicts with p1.
    expect(canDrop(root, 'p1', 'right', { panelId: 'draft' }).allowed).toBe(false);
    expect(canDrop(root, 'p1', 'right', { panelId: 'draft' }).conflictPaneId).toBe('p1');
  });

  it('forbids adding a singleton present in a sibling (edge)', () => {
    const root: GroupNode = {
      id: 'g', kind: 'group', dir: 'row', ratio: 0.5,
      children: [pane('p1', 'draft'), pane('p2', 'memory')],
    };
    // Splitting p2 to add draft conflicts with p1.
    expect(canDrop(root, 'p2', 'bottom', { panelId: 'draft' }).allowed).toBe(false);
    expect(canDrop(root, 'p2', 'bottom', { panelId: 'draft' }).conflictPaneId).toBe('p1');
  });

  it('allows adding a terminal for a different scope (edge)', () => {
    const root: LayoutNode = pane('p1', 'terminal', 'b1::projA');
    expect(canDrop(root, 'p1', 'right', { panelId: 'terminal', instanceKey: 'b1::projB' }).allowed).toBe(true);
  });

  it('forbids adding a terminal for the same scope (edge)', () => {
    const root: LayoutNode = pane('p1', 'terminal', 'b1::projA');
    expect(canDrop(root, 'p1', 'right', { panelId: 'terminal', instanceKey: 'b1::projA' }).allowed).toBe(false);
  });
});

describe('disabledZones', () => {
  it('disables all edge zones for a singleton already present, keeps center', () => {
    const root: LayoutNode = pane('p1', 'draft');
    const d = disabledZones(root, 'p1', { panelId: 'draft' });
    expect([...d].sort()).toEqual(['bottom', 'left', 'right', 'top']);
    expect(d.has('center')).toBe(false);
  });

  it('disables nothing when the panel is not present', () => {
    const root: LayoutNode = pane('p1', 'draft');
    expect(disabledZones(root, 'p1', { panelId: 'memory' }).size).toBe(0);
  });
});
