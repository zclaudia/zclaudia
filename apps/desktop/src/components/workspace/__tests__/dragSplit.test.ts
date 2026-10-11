// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  resolveDropZone,
  dropZoneToDir,
  canDrop,
  disabledZones,
  resolveTabDrop,
  resolvePointerToPane,
  resolveRootDrop,
  type Rect,
} from '../dragSplit';
import { newPane } from '../../../stores/rightWorkspaceStore';
import type { LayoutNode, PaneNode, GroupNode } from '../../../stores/rightWorkspaceStore';

const R: Rect = { left: 0, top: 0, width: 100, height: 100 };
const cx = 50,
  cy = 50;

// Build a pane fixture using the real newPane factory and override its id for
// stable test assertions. We reassign id because newPane generates a random UUID.
const pane = (id: string, toolId: string, instanceKey?: string): PaneNode => {
  const p = newPane(toolId, instanceKey);
  return { ...p, id };
};

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
  it('allows replacing a pane with a non-conflicting tool (center)', () => {
    const root: LayoutNode = pane('p1', 'draft');
    expect(canDrop(root, 'p1', 'center', { toolId: 'memory' }).allowed).toBe(true);
  });

  it('allows replacing a pane with the SAME tool (center excludes the target)', () => {
    const root: LayoutNode = pane('p1', 'draft');
    // Replacing p1 with draft is fine (it's the same pane).
    expect(canDrop(root, 'p1', 'center', { toolId: 'draft' }).allowed).toBe(true);
  });

  it('forbids splitting to add a singleton already present (edge)', () => {
    const root: LayoutNode = pane('p1', 'draft');
    // Adding draft beside p1 (any edge) conflicts with p1.
    expect(canDrop(root, 'p1', 'right', { toolId: 'draft' }).allowed).toBe(false);
    expect(canDrop(root, 'p1', 'right', { toolId: 'draft' }).conflictPaneId).toBe('p1');
  });

  it('forbids adding a singleton present in a sibling (edge)', () => {
    const root: GroupNode = {
      id: 'g',
      kind: 'group',
      dir: 'row',
      ratio: 0.5,
      children: [pane('p1', 'draft'), pane('p2', 'memory')],
    };
    // Splitting p2 to add draft conflicts with p1.
    expect(canDrop(root, 'p2', 'bottom', { toolId: 'draft' }).allowed).toBe(false);
    expect(canDrop(root, 'p2', 'bottom', { toolId: 'draft' }).conflictPaneId).toBe('p1');
  });

  it('allows adding a multi-instance tool for a different scope (edge)', () => {
    const root: LayoutNode = pane('p1', 'terminal', 'b1::projA');
    expect(
      canDrop(root, 'p1', 'right', {
        toolId: 'terminal',
        instanceKey: 'b1::projB',
        multiInstance: true,
      }).allowed
    ).toBe(true);
  });

  it('forbids adding a multi-instance tool for the same scope (edge)', () => {
    const root: LayoutNode = pane('p1', 'terminal', 'b1::projA');
    expect(
      canDrop(root, 'p1', 'right', {
        toolId: 'terminal',
        instanceKey: 'b1::projA',
        multiInstance: true,
      }).allowed
    ).toBe(false);
  });

  it('allows moving an existing ref to another pane edge, excluding the source identity', () => {
    const root: GroupNode = {
      id: 'g', kind: 'group', dir: 'row', ratio: 0.5,
      children: [pane('chat', 'chat', 's1'), pane('tool', 'draft')],
    };
    expect(canDrop(root, 'chat', 'right', {
      toolId: 'draft', sourcePaneId: 'tool', sourceIndex: 0,
    }).allowed).toBe(true);
    expect(canDrop(root, 'tool', 'left', {
      toolId: 'chat', instanceKey: 's1', sourcePaneId: 'chat', sourceIndex: 0,
    }).allowed).toBe(true);
  });

  it('keeps chat panes isolated from all center/tab merge drops', () => {
    const root: GroupNode = {
      id: 'g', kind: 'group', dir: 'row', ratio: 0.5,
      children: [pane('chat', 'chat', 's1'), pane('tool', 'draft')],
    };
    expect(canDrop(root, 'chat', 'center', { toolId: 'memory' }).allowed).toBe(false);
    expect(canDrop(root, 'tool', 'center', {
      toolId: 'chat', instanceKey: 's1', sourcePaneId: 'chat', sourceIndex: 0,
    }).allowed).toBe(false);
    expect(canDrop(root, 'chat', 'center', {
      toolId: 'chat', instanceKey: 's2', multiInstance: true,
    }).allowed).toBe(false);
  });

  it('disables edges for a one-tab self move, but allows splitting a tab out of a multi-tab pane', () => {
    const root = pane('tool', 'draft');
    const payload = { toolId: 'draft', sourcePaneId: 'tool', sourceIndex: 0 };
    expect(canDrop(root, 'tool', 'right', payload).allowed).toBe(false);
    root.tools.push({ toolId: 'memory' });
    expect(canDrop(root, 'tool', 'right', payload).allowed).toBe(true);
  });

  it('does not exclude every matching source pane ref, nor obsolete source indices', () => {
    const source = pane('tool', 'terminal', 'scopeA');
    source.tools.push({ toolId: 'terminal', instanceKey: 'scopeA' });
    const root: GroupNode = {
      id: 'g', kind: 'group', dir: 'row', ratio: 0.5,
      children: [source, pane('chat', 'chat', 's1')],
    };
    const payload = { toolId: 'terminal', instanceKey: 'scopeA', multiInstance: true,
      sourcePaneId: 'tool', sourceIndex: 0 };
    expect(canDrop(root, 'chat', 'right', payload)).toEqual({ allowed: false, conflictPaneId: 'tool' });
    source.tools[0] = { toolId: 'terminal', instanceKey: 'scopeB' };
    expect(canDrop(root, 'chat', 'right', payload).allowed).toBe(false);
    expect(canDrop(root, 'removed', 'right', payload).allowed).toBe(false);
  });

  it('matches chat conflicts by session identity, allowing distinct sessions', () => {
    const root = pane('chat', 'chat', 's1');
    expect(canDrop(root, 'chat', 'right', { toolId: 'chat', instanceKey: 's2' }).allowed).toBe(true);
    expect(canDrop(root, 'chat', 'right', { toolId: 'chat', instanceKey: 's1' }).allowed).toBe(false);
  });

});

describe('disabledZones', () => {
  it('disables all edge zones for a singleton already present, keeps center', () => {
    const root: LayoutNode = pane('p1', 'draft');
    const d = disabledZones(root, 'p1', { toolId: 'draft' });
    expect([...d].sort()).toEqual(['bottom', 'left', 'right', 'top']);
    expect(d.has('center')).toBe(false);
  });

  it('disables nothing when the tool is not present', () => {
    const root: LayoutNode = pane('p1', 'draft');
    expect(disabledZones(root, 'p1', { toolId: 'memory' }).size).toBe(0);
  });
});

describe('resolveTabDrop', () => {
  function strip(paneId: string, tabs: Array<[number, number]>): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('data-tab-strip', '');
    el.setAttribute('data-pane-id', paneId);
    el.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 300,
        bottom: 32,
        width: 300,
        height: 32,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    tabs.forEach(([l, r], i) => {
      const t = document.createElement('div');
      t.setAttribute('data-tab-index', String(i));
      t.getBoundingClientRect = () =>
        ({
          left: l,
          top: 0,
          right: r,
          bottom: 32,
          width: r - l,
          height: 32,
          x: l,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
      el.appendChild(t);
    });
    return el;
  }

  it('returns the pane id and insert index based on tab midpoints', () => {
    const container = document.createElement('div');
    container.appendChild(
      strip('P1', [
        [0, 100],
        [100, 200],
      ])
    );
    // pointer x=160 is past tab 1's midpoint (150) → insert index 2
    const hit = resolveTabDrop(container, 160, 16);
    expect(hit).toEqual({ paneId: 'P1', index: 2 });
  });

  it('returns null when the pointer is not over any strip', () => {
    const container = document.createElement('div');
    container.appendChild(strip('P1', [[0, 100]]));
    expect(resolveTabDrop(container, 16, 200)).toBeNull();
  });
});


describe('resolvePointerToPane', () => {
  it('uses viewport DOM rectangles so scrolled canvas hit-testing needs no extra offset', () => {
    const container = document.createElement('div');
    const el = document.createElement('div');
    el.setAttribute('data-pane-id', 'p1');
    // Canvas pane starts at x=600 but is scrolled left by 500: DOM rect x=100.
    el.getBoundingClientRect = () => ({ left: 100, right: 400, top: -120, bottom: 200,
      width: 300, height: 320 }) as DOMRect;
    container.appendChild(el);
    const hit = resolvePointerToPane(container, pane('p1', 'draft'), 390, 40, { toolId: 'memory' });
    expect(hit?.paneId).toBe('p1');
    expect(hit?.zone).toBe('right');
    expect(resolvePointerToPane(container, pane('p1', 'draft'), 610, 40, { toolId: 'memory' })).toBeNull();
  });
});


describe('resolveRootDrop', () => {
  const viewport = { left: 100, top: 200, width: 1000, height: 700 };
  it('restricts root drops to the outer viewport gutter on all four edges', () => {
    expect(resolveRootDrop(viewport, 104, 500)).toBe('left');
    expect(resolveRootDrop(viewport, 1096, 500)).toBe('right');
    expect(resolveRootDrop(viewport, 500, 204)).toBe('top');
    expect(resolveRootDrop(viewport, 500, 896)).toBe('bottom');
    expect(resolveRootDrop(viewport, 112, 500)).toBeNull();
    expect(resolveRootDrop(viewport, 99, 500)).toBeNull();
    expect(resolveRootDrop(viewport, 500, 901)).toBeNull();
  });
  it('uses viewport coordinates independent of canvas scrolling', () => {
    expect(resolveRootDrop({ ...viewport, left: -500, top: -300 }, -495, 0)).toBe('left');
    expect(resolveRootDrop({ left: 0, top: 0, width: 0, height: 100 }, 0, 40)).toBeNull();
  });
});
