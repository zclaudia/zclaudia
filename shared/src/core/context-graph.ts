// Context Graph wire types (SP-B). Consumed by the SP-C lineage panel.

export interface SessionLane {
  id: string;
  name: string | null;
  forkedFromSessionId: string | null;
  forkEntryId: string | null;
  createdAt: number;
  archived: boolean;
  /** Topological order (family root first; siblings by createdAt). Stable lane order for rendering. */
  laneOrder: number;
}

export interface GraphNode {
  /** Composite identity — entry ids are reused across forked sessions. */
  nodeId: string; // `${sessionId}:${entryId}`
  sessionId: string;
  entryId: string;
  entryType: 'message' | 'compaction' | 'label' | 'leaf';
  // Structural roles (can co-occur):
  isRoot: boolean;
  isBranchPoint: boolean; // >= 2 children
  isForkPoint: boolean; // referenced by a child session's forkEntryId (this session is a fork source)
  isForkBase: boolean; // this session's own forkEntryId (where it diverged from its parent)
  isActiveLeaf: boolean; // == session_leaf.leaf_id
  isBranchTip: boolean; // 0 children and not the active leaf (abandoned branch tip)
  onActivePath: boolean;
  // Intra-session topology is a tree:
  parentNodeId: string | null;
  /** Count of collapsed user/assistant projected messages strictly between parentNode and this node (endpoints excluded; toolResults not counted). */
  incomingMessageCount: number;
  timestamp: string;
  // Type payloads:
  label?: string;
  labelTargetNodeId?: string; // `${sessionId}:${targetId}`
  compaction?: {
    summary: string;
    tokensBefore: number;
    source: 'auto' | 'manual' | 'overflow' | 'preflight';
  };
  // Jump targets:
  jump: { messageId: string | null; compactionId: string | null };
}

export interface ForkEdge {
  fromNodeId: string; // `${parentSessionId}:${forkEntryId}`
  toSessionId: string;
  toNodeId: string; // `${childSessionId}:${forkEntryId}`
}

export interface ContextGraph {
  rootSessionId: string;
  focusSessionId: string;
  sessions: SessionLane[];
  nodes: GraphNode[];
  forkEdges: ForkEdge[];
  truncated: boolean;
}
