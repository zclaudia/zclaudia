import { useCallback, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import type { GraphNode } from '@zclaudia/shared';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUIStore } from '../../stores/uiStore';
import { useSelectionCoordinator } from '../../hooks/useSelectionCoordinator';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useProjectStore } from '../../stores/projectStore';
import { computeLayout } from './layout';
import { laneColor } from './nodeGlyphs';
import { LineageGraph } from './LineageGraph';
import { LineageEmptyState } from './LineageEmptyState';
import { useLineageStore } from './lineageStore';

export function LineagePanel() {
  const selectedSessionId = useSelectionStore(s => s.selectedSessionId);
  // session-list identity changes after fork/branch → reload
  const sessions = useProjectStore(s => s.sessions);
  const requestMessageJump = useUIStore(s => s.requestMessageJump);
  const { selectSession } = useSelectionCoordinator();
  const graph = useLineageStore(s => s.graph);
  const reload = useLineageStore(s => s.reload);

  useEffect(() => {
    void reload(selectedSessionId);
  }, [reload, selectedSessionId, sessions]);

  const onNodeClick = useCallback(
    (node: GraphNode) => {
      const messageId = node.jump.messageId;
      if (!messageId) return;
      const backendId = useOwnershipStore.getState().getSessionBackendId(node.sessionId);
      requestMessageJump(node.sessionId, messageId);
      selectSession(node.sessionId, { backendId });
    },
    [requestMessageJump, selectSession]
  );

  const layout = graph ? computeLayout(graph) : null;
  const isLinear = !!graph && graph.sessions.length <= 1 && graph.forkEdges.length === 0;
  const laneColorOf = useCallback(
    (sid: string) => laneColor(graph?.sessions.find(s => s.id === sid)?.laneOrder ?? 0),
    [graph]
  );

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex-1 overflow-auto">
        {layout && layout.nodes.length > 0 && (
          <LineageGraph model={layout} onNodeClick={onNodeClick} laneColorOf={laneColorOf} />
        )}
        {graph && isLinear && <LineageEmptyState />}
        {graph?.truncated && (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">
            Truncated — some earlier nodes are not shown.
          </div>
        )}
      </div>
    </div>
  );
}

export function LineageActions() {
  const selectedSessionId = useSelectionStore(s => s.selectedSessionId);
  const graph = useLineageStore(s => s.graph);
  const loading = useLineageStore(s => s.loading);
  const reload = useLineageStore(s => s.reload);

  return (
    <div className="flex items-center gap-2">
      {graph && (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {graph.sessions.length} session{graph.sessions.length > 1 ? 's' : ''}
        </span>
      )}
      <button
        aria-label="Refresh lineage"
        title="Refresh lineage"
        onClick={() => void reload(selectedSessionId)}
        disabled={loading}
        className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-60"
      >
        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
      </button>
    </div>
  );
}
