import { describe, it, expect } from 'vitest';
import type { GraphNode } from '@zclaudia/shared';
import { glyphFor, laneColor, LANE_PALETTE } from '../nodeGlyphs';

function g(p: Partial<GraphNode>): GraphNode {
  return {
    nodeId: 'x',
    sessionId: 'S',
    entryId: 'e',
    entryType: 'message',
    isRoot: false,
    isBranchPoint: false,
    isForkPoint: false,
    isForkBase: false,
    isActiveLeaf: false,
    isBranchTip: false,
    onActivePath: true,
    parentNodeId: null,
    incomingMessageCount: 0,
    timestamp: 't',
    jump: { messageId: null, compactionId: null },
    ...p,
  };
}

describe('glyphFor', () => {
  it('maps structural roles to distinct shapes', () => {
    expect(glyphFor(g({ entryType: 'compaction' })).shape).toBe('square');
    expect(glyphFor(g({ entryType: 'label' })).shape).toBe('tag');
    expect(glyphFor(g({ isActiveLeaf: true })).shape).toBe('leaf');
    expect(glyphFor(g({ isBranchTip: true, onActivePath: false })).shape).toBe('tip');
    expect(glyphFor(g({ isBranchPoint: true })).shape).toBe('branch');
    expect(glyphFor(g({ isRoot: true })).shape).toBe('dot');
  });
  it('flags fork point ring and dimming', () => {
    expect(glyphFor(g({ isForkPoint: true })).ring).toBe(true);
    expect(glyphFor(g({ isBranchTip: true, onActivePath: false })).dimmed).toBe(true);
  });
});

describe('laneColor', () => {
  it('cycles the palette by laneOrder', () => {
    expect(laneColor(0)).toBe(LANE_PALETTE[0]);
    expect(laneColor(LANE_PALETTE.length)).toBe(LANE_PALETTE[0]);
  });
});
