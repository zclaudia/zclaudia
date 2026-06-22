import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ContextGraph, GraphNode } from '@zclaudia/shared';
import { fetchContextGraph } from '../../services/api/context-graph';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUIStore } from '../../stores/uiStore';
import { useSelectionCoordinator } from '../../hooks/useSelectionCoordinator';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useProjectStore } from '../../stores/projectStore';
import { useToastStore } from '../../stores/toastStore';
import { computeLayout } from './layout';
import { laneColor } from './nodeGlyphs';
import { LineageGraph } from './LineageGraph';
import { LineageEmptyState } from './LineageEmptyState';

export function LineagePanel() {
  const selectedSessionId = useSelectionStore((s) => s.selectedSessionId);
  // session-list identity changes after fork/branch → reload
  const sessions = useProjectStore((s) => s.sessions);
  const requestMessageJump = useUIStore((s) => s.requestMessageJump);
  const { selectSession } = useSelectionCoordinator();

  const [graph, setGraph] = useState<ContextGraph | null>(null);
  const [loading, setLoading] = useState(false);

  const reqIdRef = useRef(0);

  const reload = useCallback(async () => {
    if (!selectedSessionId) { setGraph(null); return; }
    const myReq = ++reqIdRef.current;
    setLoading(true);
    try {
      const next = await fetchContextGraph(selectedSessionId);
      if (reqIdRef.current === myReq) setGraph(next);
    } catch {
      if (reqIdRef.current === myReq) {
        useToastStore.getState().add({ type: 'error', title: 'Lineage for this session is unavailable' });
        setGraph(null);
      }
    } finally {
      if (reqIdRef.current === myReq) setLoading(false);
    }
  }, [selectedSessionId]);

  useEffect(() => { void reload(); }, [reload, sessions]);

  const onNodeClick = useCallback((node: GraphNode) => {
    const messageId = node.jump.messageId;
    if (!messageId) return;
    const backendId = useOwnershipStore.getState().getSessionBackendId(node.sessionId);
    requestMessageJump(node.sessionId, messageId);
    selectSession(node.sessionId, { backendId });
  }, [requestMessageJump, selectSession]);

  const layout = graph ? computeLayout(graph) : null;
  const isLinear = !!graph && graph.sessions.length <= 1 && graph.forkEdges.length === 0;

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <span className="text-sm font-semibold text-foreground">Lineage</span>
        {graph && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {graph.sessions.length} session{graph.sessions.length > 1 ? 's' : ''}
          </span>
        )}
        <button
          aria-label="Refresh lineage"
          className={graph ? '' : 'ml-auto'}
          onClick={() => void reload()}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin text-muted-foreground' : 'text-muted-foreground'} />
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {layout && layout.nodes.length > 0 && (
          <LineageGraph
            model={layout}
            onNodeClick={onNodeClick}
            laneColorOf={(sid) => laneColor(graph!.sessions.find((s) => s.id === sid)?.laneOrder ?? 0)}
          />
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
