import { describe, it, expect, beforeEach } from 'vitest';
import {
  useSplitLayoutStore,
  findPane,
  pathTo,
  isSafeTree,
  MIN_RATIO,
  MAX_RATIO,
  type LayoutNode,
  type PaneNode,
  type GroupNode,
} from '../splitLayoutStore';

/** Walk the tree and return the first PaneNode matching `panelId`. */
function firstPaneByPanelId(root: LayoutNode | null, panelId: string): PaneNode | null {
  if (!root) return null;
  if (root.kind === 'pane') return root.panelId === panelId ? root : null;
  return firstPaneByPanelId(root.children[0], panelId) ?? firstPaneByPanelId(root.children[1], panelId);
}

/** All pane ids in the tree, depth-first. */
function allPaneIds(root: LayoutNode | null): string[] {
  if (!root) return [];
  if (root.kind === 'pane') return [root.id];
  return [...allPaneIds(root.children[0]), ...allPaneIds(root.children[1])];
}

describe('splitLayoutStore', () => {
  beforeEach(() => {
    useSplitLayoutStore.getState().reset();
    // Clear any persisted state so tests are deterministic.
    if (typeof localStorage !== 'undefined') localStorage.removeItem('claudia-split-layout');
  });

  describe('initial state', () => {
    it('starts empty (root null, no focus)', () => {
      const s = useSplitLayoutStore.getState();
      expect(s.root).toBeNull();
      expect(s.focusedPaneId).toBeNull();
    });
  });

  describe('initSingle', () => {
    it('sets a single-pane tree and focuses nothing yet', () => {
      useSplitLayoutStore.getState().initSingle('terminal');
      const root = useSplitLayoutStore.getState().root;
      expect(root).not.toBeNull();
      expect(root!.kind).toBe('pane');
      expect((root as PaneNode).panelId).toBe('terminal');
    });

    it('is idempotent — does not clobber an existing tree', () => {
      useSplitLayoutStore.getState().initSingle('terminal');
      const before = useSplitLayoutStore.getState().root;
      // Mutate the tree so we can detect clobbering.
      const paneId = (before as PaneNode).id;
      useSplitLayoutStore.getState().split(paneId, 'row', 'file-viewer');

      useSplitLayoutStore.getState().initSingle('memory'); // should be a no-op

      const after = useSplitLayoutStore.getState().root;
      expect(after).not.toBeNull();
      expect(after!.kind).toBe('group'); // split survived
      expect(allPaneIds(after)).toHaveLength(2);
    });
  });

  describe('split', () => {
    it('wraps the source pane in a row group with the new pane as the second child', () => {
      useSplitLayoutStore.getState().initSingle('terminal');
      const src = (useSplitLayoutStore.getState().root as PaneNode).id;

      const res = useSplitLayoutStore.getState().split(src, 'row', 'file-viewer');

      expect(res.ok).toBe(true);
      const root = useSplitLayoutStore.getState().root as GroupNode;
      expect(root.kind).toBe('group');
      expect(root.dir).toBe('row');
      expect(root.ratio).toBe(0.5);
      // First child is the original pane (same id), second is the new pane.
      expect((root.children[0] as PaneNode).id).toBe(src);
      expect((root.children[0] as PaneNode).panelId).toBe('terminal');
      expect((root.children[1] as PaneNode).panelId).toBe('file-viewer');
      if (res.ok) expect((root.children[1] as PaneNode).id).toBe(res.newPaneId);
      // Focus moves to the new pane.
      expect(useSplitLayoutStore.getState().focusedPaneId).toBe((root.children[1] as PaneNode).id);
    });

    it('produces a col group for dir col', () => {
      useSplitLayoutStore.getState().initSingle('memory');
      const src = (useSplitLayoutStore.getState().root as PaneNode).id;
      useSplitLayoutStore.getState().split(src, 'col', 'draft');
      expect((useSplitLayoutStore.getState().root as GroupNode).dir).toBe('col');
    });

    it('nests groups when splitting again', () => {
      useSplitLayoutStore.getState().initSingle('terminal');
      const a = (useSplitLayoutStore.getState().root as PaneNode).id;
      const r1 = useSplitLayoutStore.getState().split(a, 'row', 'file-viewer');
      // Split the newly created pane again.
      const newPaneId = r1.ok ? r1.newPaneId : '';
      useSplitLayoutStore.getState().split(newPaneId, 'col', 'memory');

      const root = useSplitLayoutStore.getState().root as GroupNode;
      expect(root.kind).toBe('group'); // outer row
      expect(root.children[1].kind).toBe('group'); // nested col
      expect((root.children[1] as GroupNode).dir).toBe('col');
      expect(allPaneIds(root)).toHaveLength(3);
    });

    it('is a no-op when the source pane does not exist', () => {
      useSplitLayoutStore.getState().initSingle('terminal');
      const before = useSplitLayoutStore.getState().root;
      const res = useSplitLayoutStore.getState().split('no-such-pane', 'row', 'draft');
      expect(res.ok).toBe(false);
      expect(useSplitLayoutStore.getState().root).toBe(before);
    });
  });

  describe('closePane', () => {
    it('collapses the parent group into the surviving sibling', () => {
      useSplitLayoutStore.getState().initSingle('terminal');
      const a = (useSplitLayoutStore.getState().root as PaneNode).id;
      const r1 = useSplitLayoutStore.getState().split(a, 'row', 'file-viewer');
      const newPaneId = r1.ok ? r1.newPaneId : '';
      // Close the original pane; the group should collapse to file-viewer.
      useSplitLayoutStore.getState().closePane(a);

      const root = useSplitLayoutStore.getState().root as PaneNode;
      expect(root.kind).toBe('pane');
      expect(root.panelId).toBe('file-viewer');
      expect(root.id).toBe(newPaneId);
    });

    it('collapses nested groups correctly', () => {
      useSplitLayoutStore.getState().initSingle('terminal');
      const a = (useSplitLayoutStore.getState().root as PaneNode).id;
      const r1 = useSplitLayoutStore.getState().split(a, 'row', 'file-viewer');
      const b = r1.ok ? r1.newPaneId : '';
      const r2 = useSplitLayoutStore.getState().split(b, 'col', 'memory');
      const c = r2.ok ? r2.newPaneId : '';
      // Close c (deepest). The inner col group should collapse to memory's sibling? No:
      // c is the second child of the col group; collapsing yields the first child (file-viewer).
      useSplitLayoutStore.getState().closePane(c);

      const root = useSplitLayoutStore.getState().root as GroupNode;
      // Outer row group still present with two leaf panes: terminal + (was file-viewer).
      expect(root.kind).toBe('group');
      expect(allPaneIds(root)).toHaveLength(2);
      expect(allPaneIds(root)).not.toContain(c);
    });

    it('resets root to null when closing the only pane', () => {
      useSplitLayoutStore.getState().initSingle('terminal');
      const a = (useSplitLayoutStore.getState().root as PaneNode).id;
      useSplitLayoutStore.getState().closePane(a);
      expect(useSplitLayoutStore.getState().root).toBeNull();
      expect(useSplitLayoutStore.getState().focusedPaneId).toBeNull();
    });

    it('is a no-op when the pane does not exist', () => {
      useSplitLayoutStore.getState().initSingle('terminal');
      const before = useSplitLayoutStore.getState().root;
      useSplitLayoutStore.getState().closePane('no-such-pane');
      expect(useSplitLayoutStore.getState().root).toBe(before);
    });

    it('moves focus to the first pane when the focused pane is closed', () => {
      useSplitLayoutStore.getState().initSingle('terminal');
      const a = (useSplitLayoutStore.getState().root as PaneNode).id;
      const r1 = useSplitLayoutStore.getState().split(a, 'row', 'file-viewer');
      const newPaneId = r1.ok ? r1.newPaneId : '';
      // Focus is on newPaneId (split set it). Close it → focus should move to `a`.
      useSplitLayoutStore.getState().closePane(newPaneId);
      expect(useSplitLayoutStore.getState().focusedPaneId).toBe(a);
    });
  });

  describe('focusPane', () => {
    it('focuses an existing pane', () => {
      useSplitLayoutStore.getState().initSingle('terminal');
      const a = (useSplitLayoutStore.getState().root as PaneNode).id;
      useSplitLayoutStore.getState().focusPane(a);
      expect(useSplitLayoutStore.getState().focusedPaneId).toBe(a);
    });

    it('is a no-op for a non-existent pane', () => {
      useSplitLayoutStore.getState().initSingle('terminal');
      const a = (useSplitLayoutStore.getState().root as PaneNode).id;
      useSplitLayoutStore.getState().focusPane(a);
      useSplitLayoutStore.getState().focusPane('no-such-pane');
      expect(useSplitLayoutStore.getState().focusedPaneId).toBe(a);
    });
  });

  describe('setRatio', () => {
    it('updates only the targeted group, clamped', () => {
      useSplitLayoutStore.getState().initSingle('terminal');
      const a = (useSplitLayoutStore.getState().root as PaneNode).id;
      useSplitLayoutStore.getState().split(a, 'row', 'file-viewer');
      const group = useSplitLayoutStore.getState().root as GroupNode;

      useSplitLayoutStore.getState().setRatio(group.id, 0.8);
      expect((useSplitLayoutStore.getState().root as GroupNode).ratio).toBe(0.8);

      useSplitLayoutStore.getState().setRatio(group.id, 0.01);
      expect((useSplitLayoutStore.getState().root as GroupNode).ratio).toBe(MIN_RATIO);

      useSplitLayoutStore.getState().setRatio(group.id, 1.5);
      expect((useSplitLayoutStore.getState().root as GroupNode).ratio).toBe(MAX_RATIO);
    });
  });

  describe('replacePane', () => {
    it('swaps the panel a pane shows', () => {
      useSplitLayoutStore.getState().initSingle('terminal');
      const a = (useSplitLayoutStore.getState().root as PaneNode).id;
      const res = useSplitLayoutStore.getState().replacePane(a, 'memory');
      expect(res.ok).toBe(true);
      expect((useSplitLayoutStore.getState().root as PaneNode).panelId).toBe('memory');
    });
  });

  describe('singleton / per-scope enforcement', () => {
    it('split refuses to create a second singleton pane and leaves the tree unchanged', () => {
      useSplitLayoutStore.getState().initSingle('draft');
      const a = (useSplitLayoutStore.getState().root as PaneNode).id;
      // Add a different singleton next to it.
      const r1 = useSplitLayoutStore.getState().split(a, 'row', 'memory');
      expect(r1.ok).toBe(true);
      const newPaneId = r1.ok ? r1.newPaneId : '';
      // Now try to add ANOTHER draft from the memory pane → must conflict with `a`.
      const before = useSplitLayoutStore.getState().root;
      const res = useSplitLayoutStore.getState().split(newPaneId, 'col', 'draft');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.conflictPaneId).toBe(a);
      expect(useSplitLayoutStore.getState().root).toBe(before); // unchanged
    });

    it('split allows terminal panes for different project scopes', () => {
      useSplitLayoutStore.getState().initSingle('terminal');
      const a = (useSplitLayoutStore.getState().root as PaneNode).id;
      // Different scope → allowed.
      const res = useSplitLayoutStore.getState().split(a, 'row', 'terminal', 'b1::projB');
      expect(res.ok).toBe(true);
      expect(allPaneIds(useSplitLayoutStore.getState().root)).toHaveLength(2);
    });

    it('split rejects terminal panes for the same project scope', () => {
      useSplitLayoutStore.setState({
        root: { id: 'p1', kind: 'pane', panelId: 'terminal', instanceKey: 'b1::projA' },
        focusedPaneId: 'p1',
      });
      const res = useSplitLayoutStore.getState().split('p1', 'row', 'terminal', 'b1::projA');
      expect(res.ok).toBe(false);
    });
  });

  describe('helpers', () => {
    it('findPane locates a pane by id', () => {
      useSplitLayoutStore.getState().initSingle('terminal');
      const a = (useSplitLayoutStore.getState().root as PaneNode).id;
      expect(findPane(useSplitLayoutStore.getState().root, a)?.panelId).toBe('terminal');
      expect(findPane(useSplitLayoutStore.getState().root, 'missing')).toBeNull();
    });

    it('pathTo returns the group ids down to the pane', () => {
      useSplitLayoutStore.getState().initSingle('terminal');
      const a = (useSplitLayoutStore.getState().root as PaneNode).id;
      const r1 = useSplitLayoutStore.getState().split(a, 'row', 'file-viewer');
      const b = r1.ok ? r1.newPaneId : '';
      const r2 = useSplitLayoutStore.getState().split(b, 'col', 'memory');
      const c = r2.ok ? r2.newPaneId : '';

      const path = pathTo(useSplitLayoutStore.getState().root, c);
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThanOrEqual(1); // at least the inner group
    });

    it('firstPaneByPanelId helper works', () => {
      useSplitLayoutStore.getState().initSingle('terminal');
      const hit = firstPaneByPanelId(useSplitLayoutStore.getState().root, 'terminal');
      expect(hit).not.toBeNull();
      expect(firstPaneByPanelId(useSplitLayoutStore.getState().root, 'draft')).toBeNull();
    });
  });

  describe('isSafeTree (persist corruption guard)', () => {
    it('accepts a valid pane', () => {
      expect(isSafeTree({ id: 'x', kind: 'pane', panelId: 'terminal' })).toBe(true);
    });
    it('accepts a valid group', () => {
      expect(
        isSafeTree({
          id: 'g', kind: 'group', dir: 'row', ratio: 0.5,
          children: [
            { id: 'a', kind: 'pane', panelId: 'terminal' },
            { id: 'b', kind: 'pane', panelId: 'memory' },
          ],
        }),
      ).toBe(true);
    });
    it('rejects malformed shapes', () => {
      expect(isSafeTree(null)).toBe(false);
      expect(isSafeTree('not-a-node')).toBe(false);
      expect(isSafeTree({ id: 'x', kind: 'pane' })).toBe(false); // missing panelId
      expect(isSafeTree({ id: 'g', kind: 'group', dir: 'row', ratio: 0.5, children: [] })).toBe(false); // too few children
      expect(
        isSafeTree({ id: 'g', kind: 'group', dir: 'sideways', ratio: 0.5, children: [1, 2] }),
      ).toBe(false); // bad dir + bad children
    });
  });
});
