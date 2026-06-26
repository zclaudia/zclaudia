import { describe, it, expect, beforeEach } from 'vitest';
import {
  newPane, findPane, findPaneWithTool, findToolConflict,
  removePane, setRatioAt, pickFirstPane, isSafeTree, isSplitWorkspace,
  activeToolRef, sameRef,
  type LayoutNode,
} from '../rightWorkspaceStore';
import { useRightWorkspaceStore } from '../rightWorkspaceStore';

const reset = () => useRightWorkspaceStore.setState({ bySession: {}, order: [] });

function group(a: LayoutNode, b: LayoutNode): LayoutNode {
  return { id: 'g1', kind: 'group', dir: 'row', ratio: 0.5, children: [a, b] };
}

describe('rightWorkspaceStore helpers', () => {
  it('newPane wraps a single active tool', () => {
    const p = newPane('terminal', 'be::proj');
    expect(p.kind).toBe('pane');
    expect(p.tools).toEqual([{ toolId: 'terminal', instanceKey: 'be::proj' }]);
    expect(p.activeToolId).toBe('terminal');
  });

  it('newPane records activeInstanceKey and sameRef matches a tab', () => {
    const p = newPane('terminal', 'be::proj');
    expect(p.activeInstanceKey).toBe('be::proj');
    expect(sameRef(p.tools[0], 'terminal', 'be::proj')).toBe(true);
    expect(sameRef(p.tools[0], 'terminal', 'be::other')).toBe(false);
  });

  it('activeToolRef disambiguates two same-tool tabs by instanceKey', () => {
    const pane = {
      id: 'p', kind: 'pane' as const,
      tools: [{ toolId: 'terminal', instanceKey: 'a' }, { toolId: 'terminal', instanceKey: 'b' }],
      activeToolId: 'terminal', activeInstanceKey: 'b',
    };
    expect(activeToolRef(pane).instanceKey).toBe('b');
  });

  it('findPane locates a pane by id', () => {
    const a = newPane('file-viewer');
    const root = group(a, newPane('terminal'));
    expect(findPane(root, a.id)?.id).toBe(a.id);
    expect(findPane(root, 'nope')).toBeNull();
  });

  it('findPaneWithTool matches singleton by toolId, ignores instanceKey', () => {
    const a = newPane('file-viewer');
    const root = group(a, newPane('terminal', 'be::p'));
    expect(findPaneWithTool(root, 'file-viewer', undefined, true)).toBe(a.id);
  });

  it('findPaneWithTool matches multi-instance only on same instanceKey', () => {
    const t = newPane('terminal', 'be::p');
    const root = group(t, newPane('file-viewer'));
    expect(findPaneWithTool(root, 'terminal', 'be::p', false)).toBe(t.id);
    expect(findPaneWithTool(root, 'terminal', 'be::other', false)).toBeNull();
  });

  it('findToolConflict flags a second singleton, excluding a pane', () => {
    const a = newPane('memory');
    const b = newPane('terminal');
    const root = group(a, b);
    expect(findToolConflict(root, 'memory', undefined, true, b.id)).toBe(a.id);
    expect(findToolConflict(root, 'memory', undefined, true, a.id)).toBeNull();
  });

  it('removePane collapses a group to the surviving sibling', () => {
    const a = newPane('file-viewer');
    const b = newPane('terminal');
    const root = group(a, b);
    expect(removePane(root, b.id)).toEqual(a);
    expect(removePane(a, a.id)).toBeNull();
  });

  it('setRatioAt clamps to [0.1, 0.9]', () => {
    const root = group(newPane('a'), newPane('b')) as Extract<LayoutNode, { kind: 'group' }>;
    const updated = setRatioAt(root, 'g1', 5) as Extract<LayoutNode, { kind: 'group' }>;
    expect(updated.ratio).toBe(0.9);
  });

  it('pickFirstPane returns the leftmost pane id', () => {
    const a = newPane('a');
    expect(pickFirstPane(group(a, newPane('b')))).toBe(a.id);
  });

  it('isSafeTree validates pane shape (tools + activeToolId)', () => {
    expect(isSafeTree(newPane('a'))).toBe(true);
    expect(isSafeTree({ id: 'x', kind: 'pane', tools: [], activeToolId: '' })).toBe(false);
    expect(isSafeTree({ kind: 'pane' })).toBe(false);
  });

  it('isSplitWorkspace is true only for a group root', () => {
    expect(isSplitWorkspace(newPane('a'))).toBe(false);
    expect(isSplitWorkspace(group(newPane('a'), newPane('b')))).toBe(true);
    expect(isSplitWorkspace(null)).toBe(false);
  });
});

describe('rightWorkspaceStore — simple actions', () => {
  beforeEach(reset);

  it('ensureSession creates an empty workspace once', () => {
    const s = useRightWorkspaceStore.getState();
    s.ensureSession('A');
    expect(useRightWorkspaceStore.getState().bySession.A)
      .toEqual({ root: null, primaryPaneId: null, focusedPaneId: null });
    s.ensureSession('A'); // idempotent
    expect(useRightWorkspaceStore.getState().order).toEqual(['A']);
  });

  it('removeSession drops the entry and order', () => {
    const s = useRightWorkspaceStore.getState();
    s.ensureSession('A');
    s.removeSession('A');
    expect(useRightWorkspaceStore.getState().bySession.A).toBeUndefined();
    expect(useRightWorkspaceStore.getState().order).toEqual([]);
  });
});

describe('rightWorkspaceStore — openTool', () => {
  beforeEach(reset);

  it('seeds the first pane as primary + focused', () => {
    useRightWorkspaceStore.getState().openTool('A', 'file-viewer', { openMode: 'shared' });
    const ws = useRightWorkspaceStore.getState().bySession.A;
    expect(ws.root!.kind).toBe('pane');
    expect((ws.root as any).activeToolId).toBe('file-viewer');
    expect(ws.primaryPaneId).toBe(ws.root!.id);
    expect(ws.focusedPaneId).toBe(ws.root!.id);
  });

  it('shared tool reuses the primary pane (replaces its tool)', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'file-viewer', { openMode: 'shared' });
    const primary = useRightWorkspaceStore.getState().bySession.A.primaryPaneId;
    s.openTool('A', 'session-changes', { openMode: 'shared' });
    const ws = useRightWorkspaceStore.getState().bySession.A;
    expect(ws.root!.kind).toBe('pane');
    expect(ws.root!.id).toBe(primary);
    expect((ws.root as any).activeToolId).toBe('session-changes');
  });

  it('dedicated tool opens its own pane and does not hijack the primary', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'file-viewer', { openMode: 'shared' });
    s.openTool('A', 'terminal', { openMode: 'dedicated', instanceKey: 'be::p', multiInstance: true });
    const ws = useRightWorkspaceStore.getState().bySession.A;
    expect(ws.root!.kind).toBe('group');
    // primary still shows file-viewer
    const primaryPane = findPaneFor(ws.root, ws.primaryPaneId!);
    expect(primaryPane.activeToolId).toBe('file-viewer');
  });

  it('opening an already-open singleton focuses it instead of duplicating', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'memory', { openMode: 'dedicated' });
    s.openTool('A', 'terminal', { openMode: 'dedicated', instanceKey: 'be::p', multiInstance: true });
    const before = useRightWorkspaceStore.getState().bySession.A.root;
    s.openTool('A', 'memory', { openMode: 'dedicated' }); // already open
    const ws = useRightWorkspaceStore.getState().bySession.A;
    expect(countPanes(ws.root)).toBe(countPanes(before)); // no new pane
    const memPaneId = findPaneWithTool(ws.root, 'memory', undefined, true);
    expect(ws.focusedPaneId).toBe(memPaneId);
  });

  it('multi-instance tool with a different instanceKey opens a new pane (no dedupe)', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'file-viewer', { openMode: 'shared' });               // primary seed
    s.openTool('A', 'terminal', { openMode: 'dedicated', instanceKey: 'be::p', multiInstance: true });
    const before = useRightWorkspaceStore.getState().bySession.A.root;
    s.openTool('A', 'terminal', { openMode: 'dedicated', instanceKey: 'be::q', multiInstance: true });
    const after = useRightWorkspaceStore.getState().bySession.A.root;
    expect(countPanes(after)).toBe(countPanes(before) + 1); // new pane, not deduped
  });

  it('isolates layouts per session', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'file-viewer', { openMode: 'shared' });
    s.openTool('B', 'terminal', { openMode: 'dedicated' });
    expect((useRightWorkspaceStore.getState().bySession.A.root as any).activeToolId).toBe('file-viewer');
    expect((useRightWorkspaceStore.getState().bySession.B.root as any).activeToolId).toBe('terminal');
  });
});

describe('rightWorkspaceStore — simple actions (deferred)', () => {
  beforeEach(reset);

  it('closePane collapses the group and reassigns primary/focus', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'file-viewer', { openMode: 'shared' });
    s.openTool('A', 'terminal', { openMode: 'dedicated', instanceKey: 'be::p', multiInstance: true });
    const ws = useRightWorkspaceStore.getState().bySession.A;
    const root = ws.root!;
    expect(root.kind).toBe('group');
    // close the dedicated (second) pane
    const second = (root as any).children[1].id;
    s.closePane('A', second);
    const after = useRightWorkspaceStore.getState().bySession.A;
    expect(after.root!.kind).toBe('pane');
    expect(after.focusedPaneId).toBe(after.root!.id);
    expect(after.primaryPaneId).toBe(after.root!.id);
  });

  it('setRatio updates the group ratio', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'file-viewer', { openMode: 'shared' });
    s.openTool('A', 'memory', { openMode: 'dedicated' });
    const g = useRightWorkspaceStore.getState().bySession.A.root as any;
    s.setRatio('A', g.id, 0.7);
    expect((useRightWorkspaceStore.getState().bySession.A.root as any).ratio).toBeCloseTo(0.7);
  });
});

describe('rightWorkspaceStore — splitPane / replaceTool', () => {
  beforeEach(reset);

  it('splitPane wraps the source pane and inserts the new pane second', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'file-viewer', { openMode: 'shared' });
    const from = useRightWorkspaceStore.getState().bySession.A.root!.id;
    const res = s.splitPane('A', from, 'col', 'memory');
    expect(res.ok).toBe(true);
    const ws = useRightWorkspaceStore.getState().bySession.A;
    const root = ws.root as any;
    expect(root.kind).toBe('group');
    expect(root.dir).toBe('col');
    expect(root.children[0].id).toBe(from);
    expect(root.children[1].activeToolId).toBe('memory');
    if (!res.ok) throw new Error('split failed');
    expect(ws.focusedPaneId).toBe(res.newPaneId);
  });

  it('splitPane with insertFirst=true places the new pane as children[0]', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'file-viewer', { openMode: 'shared' });
    const from = useRightWorkspaceStore.getState().bySession.A.root!.id;
    const res = s.splitPane('A', from, 'row', 'memory', undefined, undefined, true);
    expect(res.ok).toBe(true);
    const root = useRightWorkspaceStore.getState().bySession.A.root as any;
    expect(root.kind).toBe('group');
    // new pane is first, original pane is second
    if (!res.ok) throw new Error('split failed');
    expect(root.children[0].id).toBe(res.newPaneId);
    expect(root.children[1].id).toBe(from);
  });

  it('splitPane refuses a duplicate singleton and leaves the tree unchanged', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'memory', { openMode: 'shared' });
    const from = useRightWorkspaceStore.getState().bySession.A.root!.id;
    const before = useRightWorkspaceStore.getState().bySession.A.root;
    const res = s.splitPane('A', from, 'row', 'memory');
    expect(res.ok).toBe(false);
    expect(useRightWorkspaceStore.getState().bySession.A.root).toBe(before);
  });

  it('replaceTool swaps a pane active tool', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'file-viewer', { openMode: 'shared' });
    const pane = useRightWorkspaceStore.getState().bySession.A.root!.id;
    const res = s.replaceTool('A', pane, 'memory');
    expect(res.ok).toBe(true);
    expect((useRightWorkspaceStore.getState().bySession.A.root as any).activeToolId).toBe('memory');
  });
});

describe('rightWorkspaceStore — LRU eviction', () => {
  beforeEach(reset);

  it('evicts the oldest session beyond the 50-session cap', () => {
    const s = useRightWorkspaceStore.getState();
    for (let i = 0; i < 55; i++) s.openTool(`S${i}`, 'memory', { openMode: 'shared' });
    const { bySession, order } = useRightWorkspaceStore.getState();
    expect(order.length).toBe(50);
    expect(Object.keys(bySession).length).toBe(50);
    expect(bySession.S0).toBeUndefined();   // oldest evicted
    expect(bySession.S54).toBeDefined();    // newest kept
    expect(order[0]).toBe('S54');           // MRU front
  });
});

describe('rightWorkspaceStore — tab actions', () => {
  beforeEach(reset);

  it('setActiveTool switches the active tab and focuses the pane', () => {
    const pane = {
      id: 'P1', kind: 'pane' as const,
      tools: [{ toolId: 'memory' }, { toolId: 'file-viewer' }],
      activeToolId: 'file-viewer', activeInstanceKey: undefined,
    };
    useRightWorkspaceStore.setState({ bySession: { A: { root: pane, primaryPaneId: 'P1', focusedPaneId: 'P1' } }, order: ['A'] });
    useRightWorkspaceStore.getState().setActiveTool('A', 'P1', 'memory');
    const ws = useRightWorkspaceStore.getState().bySession.A;
    expect((ws.root as any).activeToolId).toBe('memory');
    expect(ws.focusedPaneId).toBe('P1');
  });

  it('setActiveTool is a no-op when the tool is not in the pane', () => {
    const pane = { id: 'P1', kind: 'pane' as const, tools: [{ toolId: 'memory' }], activeToolId: 'memory' };
    useRightWorkspaceStore.setState({ bySession: { A: { root: pane, primaryPaneId: 'P1', focusedPaneId: 'P1' } }, order: ['A'] });
    const before = useRightWorkspaceStore.getState().bySession.A.root;
    useRightWorkspaceStore.getState().setActiveTool('A', 'P1', 'terminal');
    expect(useRightWorkspaceStore.getState().bySession.A.root).toBe(before);
  });

  it('closeTool removes one tab and keeps the active tab', () => {
    const pane = { id: 'P1', kind: 'pane' as const,
      tools: [{ toolId: 'memory' }, { toolId: 'file-viewer' }, { toolId: 'session-changes' }],
      activeToolId: 'session-changes' };
    useRightWorkspaceStore.setState({ bySession: { A: { root: pane, primaryPaneId: 'P1', focusedPaneId: 'P1' } }, order: ['A'] });
    useRightWorkspaceStore.getState().closeTool('A', 'P1', 'file-viewer');
    const p = useRightWorkspaceStore.getState().bySession.A.root as any;
    expect(p.tools.map((t: any) => t.toolId)).toEqual(['memory', 'session-changes']);
    expect(p.activeToolId).toBe('session-changes');
  });

  it('closeTool re-activates a neighbor when the active tab closes', () => {
    const pane = { id: 'P1', kind: 'pane' as const,
      tools: [{ toolId: 'memory' }, { toolId: 'file-viewer' }, { toolId: 'session-changes' }],
      activeToolId: 'file-viewer' };
    useRightWorkspaceStore.setState({ bySession: { A: { root: pane, primaryPaneId: 'P1', focusedPaneId: 'P1' } }, order: ['A'] });
    useRightWorkspaceStore.getState().closeTool('A', 'P1', 'file-viewer');
    const p = useRightWorkspaceStore.getState().bySession.A.root as any;
    expect(p.tools.map((t: any) => t.toolId)).toEqual(['memory', 'session-changes']);
    expect(p.activeToolId).toBe('session-changes'); // neighbor at the closed index
  });

  it('closeTool collapses the pane when its last tab closes', () => {
    const pane = { id: 'P1', kind: 'pane' as const, tools: [{ toolId: 'memory' }], activeToolId: 'memory' };
    useRightWorkspaceStore.setState({ bySession: { A: { root: pane, primaryPaneId: 'P1', focusedPaneId: 'P1' } }, order: ['A'] });
    useRightWorkspaceStore.getState().closeTool('A', 'P1', 'memory');
    const ws = useRightWorkspaceStore.getState().bySession.A;
    expect(ws.root).toBeNull();
    expect(ws.focusedPaneId).toBeNull();
  });
});

// test helpers
function findPaneFor(root: any, id: string): any {
  return findPane(root, id);
}
function countPanes(root: any): number {
  if (!root) return 0;
  if (root.kind === 'pane') return 1;
  return countPanes(root.children[0]) + countPanes(root.children[1]);
}
