import { describe, it, expect } from 'vitest';
import {
  newPane, findPane, findPaneWithTool, findToolConflict,
  removePane, setRatioAt, pickFirstPane, isSafeTree, isSplitWorkspace,
  type LayoutNode,
} from '../rightWorkspaceStore';

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
