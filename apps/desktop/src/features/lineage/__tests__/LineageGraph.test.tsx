import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { LayoutModel } from '../layout';
import { LineageGraph } from '../LineageGraph';

const model: LayoutModel = {
  laneLabels: [{ sessionId: 'S0', name: 'main', x: 44, archived: false }],
  nodes: [
    { nodeId: 'S0:r', sessionId: 'S0', x: 44, y: 36, archived: false, node: {
      nodeId: 'S0:r', sessionId: 'S0', entryId: 'r', entryType: 'message', isRoot: true,
      isBranchPoint: false, isForkPoint: false, isForkBase: false, isActiveLeaf: false,
      isBranchTip: false, onActivePath: true, parentNodeId: null, incomingMessageCount: 0,
      timestamp: 't', jump: { messageId: 'm1', compactionId: null } } },
    { nodeId: 'S0:x', sessionId: 'S0', x: 44, y: 92, archived: false, node: {
      nodeId: 'S0:x', sessionId: 'S0', entryId: 'x', entryType: 'leaf', isRoot: false,
      isBranchPoint: false, isForkPoint: false, isForkBase: false, isActiveLeaf: true,
      isBranchTip: false, onActivePath: true, parentNodeId: 'S0:r', incomingMessageCount: 2,
      timestamp: 't', jump: { messageId: null, compactionId: null } } },
  ],
  edges: [{ id: 'm:S0:r->S0:x', kind: 'message', fromX: 44, fromY: 36, toX: 44, toY: 92, messageCount: 2, dimmed: false }],
  badges: [], width: 200, height: 160, truncated: false,
};

describe('LineageGraph', () => {
  it('renders a clickable jumpable node and fires onNodeClick', () => {
    const onNodeClick = vi.fn();
    const { getByTestId } = render(<LineageGraph model={model} onNodeClick={onNodeClick} />);
    fireEvent.click(getByTestId('lineage-node-S0:r'));
    expect(onNodeClick).toHaveBeenCalledWith(model.nodes[0].node);
  });

  it('does not fire for non-jumpable nodes', () => {
    const onNodeClick = vi.fn();
    const { getByTestId } = render(<LineageGraph model={model} onNodeClick={onNodeClick} />);
    fireEvent.click(getByTestId('lineage-node-S0:x'));
    expect(onNodeClick).not.toHaveBeenCalled();
  });

  it('renders the collapsed message count label', () => {
    const { getByText } = render(<LineageGraph model={model} onNodeClick={() => {}} />);
    expect(getByText('2')).toBeTruthy();
  });

  it('treats a compaction-only node (no messageId) as non-jumpable', () => {
    const onNodeClick = vi.fn();
    const m: LayoutModel = {
      laneLabels: [], badges: [], edges: [], width: 100, height: 100, truncated: false,
      nodes: [{ nodeId: 'S0:k', sessionId: 'S0', x: 44, y: 36, archived: false, node: {
        nodeId: 'S0:k', sessionId: 'S0', entryId: 'k', entryType: 'compaction', isRoot: false,
        isBranchPoint: false, isForkPoint: false, isForkBase: false, isActiveLeaf: false,
        isBranchTip: false, onActivePath: true, parentNodeId: null, incomingMessageCount: 0,
        timestamp: 't', jump: { messageId: null, compactionId: 'cmp-1' } } }],
    };
    const { getByTestId } = render(<LineageGraph model={m} onNodeClick={onNodeClick} />);
    fireEvent.click(getByTestId('lineage-node-S0:k'));
    expect(onNodeClick).not.toHaveBeenCalled();
  });

  it('treats nodes in an archived (dead) lane as non-jumpable', () => {
    const onNodeClick = vi.fn();
    const m: LayoutModel = {
      laneLabels: [{ sessionId: 'S0', name: 'old', x: 44, archived: true }],
      badges: [], edges: [], width: 100, height: 100, truncated: false,
      nodes: [{ nodeId: 'S0:r', sessionId: 'S0', x: 44, y: 36, archived: true, node: {
        nodeId: 'S0:r', sessionId: 'S0', entryId: 'r', entryType: 'message', isRoot: true,
        isBranchPoint: false, isForkPoint: false, isForkBase: false, isActiveLeaf: false,
        isBranchTip: false, onActivePath: true, parentNodeId: null, incomingMessageCount: 0,
        timestamp: 't', jump: { messageId: 'm1', compactionId: null } } }],
    };
    const { getByTestId } = render(<LineageGraph model={m} onNodeClick={onNodeClick} />);
    fireEvent.click(getByTestId('lineage-node-S0:r'));
    expect(onNodeClick).not.toHaveBeenCalled();
  });
});
