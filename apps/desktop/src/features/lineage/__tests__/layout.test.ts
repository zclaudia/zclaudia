import { describe, it, expect } from 'vitest';
import type { ContextGraph, GraphNode } from '@zclaudia/shared';
import { computeLayout, MARGIN_X, MARGIN_TOP, ROW_GAP } from '../layout';

function node(partial: Partial<GraphNode> & { nodeId: string; sessionId: string; entryId: string }): GraphNode {
  return {
    entryType: 'message', isRoot: false, isBranchPoint: false, isForkPoint: false,
    isForkBase: false, isActiveLeaf: false, isBranchTip: false, onActivePath: true,
    parentNodeId: null, incomingMessageCount: 0, timestamp: '2026-01-01T00:00:00Z',
    jump: { messageId: null, compactionId: null }, ...partial,
  };
}

const LINEAR: ContextGraph = {
  rootSessionId: 'S0', focusSessionId: 'S0', truncated: false, forkEdges: [],
  sessions: [{ id: 'S0', name: 'main', forkedFromSessionId: null, forkEntryId: null, createdAt: 1, archived: false, laneOrder: 0 }],
  nodes: [
    node({ nodeId: 'S0:r', sessionId: 'S0', entryId: 'r', isRoot: true }),
    node({ nodeId: 'S0:c', sessionId: 'S0', entryId: 'c', entryType: 'compaction', parentNodeId: 'S0:r', incomingMessageCount: 5,
           compaction: { summary: 's', tokensBefore: 100, source: 'auto' } }),
    node({ nodeId: 'S0:l', sessionId: 'S0', entryId: 'l', entryType: 'leaf', isActiveLeaf: true, parentNodeId: 'S0:c', incomingMessageCount: 3 }),
  ],
};

describe('computeLayout — linear', () => {
  it('places a single lane as a straight column with depth-based y', () => {
    const m = computeLayout(LINEAR);
    const by = Object.fromEntries(m.nodes.map((n) => [n.nodeId, n]));
    expect(m.nodes).toHaveLength(3);
    expect(by['S0:r'].x).toBe(MARGIN_X);
    expect(by['S0:c'].x).toBe(MARGIN_X);
    expect(by['S0:l'].x).toBe(MARGIN_X);
    expect(by['S0:r'].y).toBe(MARGIN_TOP);
    expect(by['S0:c'].y).toBe(MARGIN_TOP + ROW_GAP);
    expect(by['S0:l'].y).toBe(MARGIN_TOP + 2 * ROW_GAP);
  });

  it('emits message edges carrying incomingMessageCount', () => {
    const m = computeLayout(LINEAR);
    const msgEdges = m.edges.filter((e) => e.kind === 'message');
    expect(msgEdges).toHaveLength(2);
    const toC = msgEdges.find((e) => e.toY === MARGIN_TOP + ROW_GAP)!;
    expect(toC.messageCount).toBe(5);
  });

  it('emits one lane label', () => {
    const m = computeLayout(LINEAR);
    expect(m.laneLabels).toEqual([{ sessionId: 'S0', name: 'main', x: MARGIN_X, archived: false }]);
  });
});

const FORK: ContextGraph = {
  rootSessionId: 'S0', focusSessionId: 'S1', truncated: false,
  forkEdges: [{ fromNodeId: 'S0:c', toSessionId: 'S1', toNodeId: 'S1:c' }],
  sessions: [
    { id: 'S0', name: 'main', forkedFromSessionId: null, forkEntryId: null, createdAt: 1, archived: false, laneOrder: 0 },
    { id: 'S1', name: 'exp', forkedFromSessionId: 'S0', forkEntryId: 'c', createdAt: 2, archived: false, laneOrder: 1 },
  ],
  nodes: [
    node({ nodeId: 'S0:r', sessionId: 'S0', entryId: 'r', isRoot: true }),
    node({ nodeId: 'S0:c', sessionId: 'S0', entryId: 'c', isForkPoint: true, parentNodeId: 'S0:r', incomingMessageCount: 5 }),
    node({ nodeId: 'S0:l', sessionId: 'S0', entryId: 'l', entryType: 'leaf', isActiveLeaf: true, parentNodeId: 'S0:c', incomingMessageCount: 2 }),
    node({ nodeId: 'S1:r', sessionId: 'S1', entryId: 'r', isRoot: true }),
    node({ nodeId: 'S1:c', sessionId: 'S1', entryId: 'c', isForkBase: true, parentNodeId: 'S1:r', incomingMessageCount: 5 }),
    node({ nodeId: 'S1:l', sessionId: 'S1', entryId: 'l', entryType: 'leaf', isActiveLeaf: true, parentNodeId: 'S1:c', incomingMessageCount: 2 }),
  ],
};

describe('computeLayout — fork + shared prefix', () => {
  it('drops the duplicated prefix above the child forkBase', () => {
    const m = computeLayout(FORK);
    const ids = m.nodes.map((n) => n.nodeId).sort();
    expect(ids).toEqual(['S0:c', 'S0:l', 'S0:r', 'S1:c', 'S1:l']);
  });

  it('aligns child forkBase to its parent fork point depth', () => {
    const m = computeLayout(FORK);
    const by = Object.fromEntries(m.nodes.map((n) => [n.nodeId, n]));
    expect(by['S1:c'].y).toBe(by['S0:c'].y);
    expect(by['S1:c'].x).toBeGreaterThan(by['S0:c'].x);
  });

  it('emits a fork edge from parent fork point to child forkBase', () => {
    const m = computeLayout(FORK);
    const forkEdges = m.edges.filter((e) => e.kind === 'fork');
    expect(forkEdges).toHaveLength(1);
    expect(forkEdges[0].id).toBe('f:S0:c->S1:c');
  });
});

function branchGraph(extraSiblings: number): ContextGraph {
  const nodes: GraphNode[] = [
    node({ nodeId: 'S0:r', sessionId: 'S0', entryId: 'r', isRoot: true }),
    node({ nodeId: 'S0:bp', sessionId: 'S0', entryId: 'bp', isBranchPoint: true, parentNodeId: 'S0:r', incomingMessageCount: 1 }),
    node({ nodeId: 'S0:active', sessionId: 'S0', entryId: 'active', entryType: 'leaf', isActiveLeaf: true, parentNodeId: 'S0:bp', incomingMessageCount: 1 }),
  ];
  for (let i = 0; i < extraSiblings; i++) {
    nodes.push(node({ nodeId: `S0:tip${i}`, sessionId: 'S0', entryId: `tip${i}`, entryType: 'leaf',
      isBranchTip: true, onActivePath: false, parentNodeId: 'S0:bp', incomingMessageCount: 1, timestamp: `2026-01-0${i + 1}T00:00:00Z` }));
  }
  return {
    rootSessionId: 'S0', focusSessionId: 'S0', truncated: false, forkEdges: [],
    sessions: [{ id: 'S0', name: 'main', forkedFromSessionId: null, forkEntryId: null, createdAt: 1, archived: false, laneOrder: 0 }],
    nodes,
  };
}

describe('computeLayout — intra-session branches', () => {
  it('keeps the active path on the spine and doglegs siblings right', () => {
    const m = computeLayout(branchGraph(1));
    const by = Object.fromEntries(m.nodes.map((n) => [n.nodeId, n]));
    expect(by['S0:active'].x).toBe(by['S0:bp'].x);
    expect(by['S0:tip0'].x).toBeGreaterThan(by['S0:bp'].x);
  });

  it('degrades siblings beyond MAX_SUBLANES to a badge', () => {
    const m = computeLayout(branchGraph(5));
    const rendered = m.nodes.filter((n) => n.nodeId.startsWith('S0:tip')).length;
    expect(rendered).toBe(2);
    const badge = m.badges.find((b) => b.branchNodeId === 'S0:bp');
    expect(badge?.count).toBe(3);
  });
});

describe('computeLayout — truncation & multi-branch robustness', () => {
  it('places all dangling-root siblings when their shared parent was truncated (I1)', () => {
    const DANGLING: ContextGraph = {
      rootSessionId: 'S0', focusSessionId: 'S0', truncated: true, forkEdges: [],
      sessions: [{ id: 'S0', name: 'main', forkedFromSessionId: null, forkEntryId: null, createdAt: 1, archived: false, laneOrder: 0 }],
      nodes: [
        node({ nodeId: 'S0:a', sessionId: 'S0', entryId: 'a', parentNodeId: 'S0:gone', timestamp: '2026-01-01T00:00:00Z' }),
        node({ nodeId: 'S0:b', sessionId: 'S0', entryId: 'b', parentNodeId: 'S0:gone', onActivePath: false, timestamp: '2026-01-02T00:00:00Z' }),
      ],
    };
    const ids = computeLayout(DANGLING).nodes.map((n) => n.nodeId).sort();
    expect(ids).toEqual(['S0:a', 'S0:b']);
  });

  it('caps doglegs per branch point, not cumulatively across the session (I2)', () => {
    const G: ContextGraph = {
      rootSessionId: 'S0', focusSessionId: 'S0', truncated: false, forkEdges: [],
      sessions: [{ id: 'S0', name: 'main', forkedFromSessionId: null, forkEntryId: null, createdAt: 1, archived: false, laneOrder: 0 }],
      nodes: [
        node({ nodeId: 'S0:r', sessionId: 'S0', entryId: 'r', isRoot: true }),
        node({ nodeId: 'S0:bp1', sessionId: 'S0', entryId: 'bp1', isBranchPoint: true, parentNodeId: 'S0:r' }),
        node({ nodeId: 'S0:bp1t0', sessionId: 'S0', entryId: 'bp1t0', isBranchTip: true, onActivePath: false, parentNodeId: 'S0:bp1', timestamp: '2026-01-02T00:00:00Z' }),
        node({ nodeId: 'S0:bp1t1', sessionId: 'S0', entryId: 'bp1t1', isBranchTip: true, onActivePath: false, parentNodeId: 'S0:bp1', timestamp: '2026-01-03T00:00:00Z' }),
        node({ nodeId: 'S0:bp2', sessionId: 'S0', entryId: 'bp2', isBranchPoint: true, parentNodeId: 'S0:bp1' }),
        node({ nodeId: 'S0:active', sessionId: 'S0', entryId: 'active', entryType: 'leaf', isActiveLeaf: true, parentNodeId: 'S0:bp2' }),
        node({ nodeId: 'S0:bp2t0', sessionId: 'S0', entryId: 'bp2t0', isBranchTip: true, onActivePath: false, parentNodeId: 'S0:bp2', timestamp: '2026-01-02T00:00:00Z' }),
      ],
    };
    const m = computeLayout(G);
    const ids = new Set(m.nodes.map((n) => n.nodeId));
    expect(ids.has('S0:bp2t0')).toBe(true); // bp1 used doglegs, but bp2's lone extra child must still render
    expect(m.badges.find((b) => b.branchNodeId === 'S0:bp2')).toBeUndefined();
  });
});

describe('computeLayout — archived lanes', () => {
  it('marks nodes in an archived session as archived', () => {
    const G: ContextGraph = {
      rootSessionId: 'S0', focusSessionId: 'S0', truncated: false, forkEdges: [],
      sessions: [{ id: 'S0', name: 'old', forkedFromSessionId: null, forkEntryId: null, createdAt: 1, archived: true, laneOrder: 0 }],
      nodes: [node({ nodeId: 'S0:r', sessionId: 'S0', entryId: 'r', isRoot: true })],
    };
    const m = computeLayout(G);
    expect(m.nodes[0].archived).toBe(true);
    expect(m.laneLabels[0].archived).toBe(true);
  });
});
