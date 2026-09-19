import { useCallback, useEffect, useState } from 'react';
import { useAgentReadinessStore } from '../../stores/agentReadinessStore';
import type { AgentReadinessReason } from '@zclaudia/shared/core/agent-readiness';
import { agentReadinessReasonFromDetails } from './derive';

/**
 * Agent-readiness gating for the sidebar's creation flows: refreshes readiness
 * when the connection is established, opens the guidance dialog when an action
 * would fail (AGENT_NOT_READY or an unusable readiness state), and exposes
 * `runAfterAgentGate` so callbacks only run once an agent is ready.
 */
export function useAgentGate({ isConnected }: { isConnected: boolean }) {
  const refreshReadiness = useAgentReadinessStore(s => s.refresh);
  const [agentDialogReason, setAgentDialogReason] = useState<AgentReadinessReason | undefined>(
    undefined
  );
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);

  // Fetch agent readiness whenever the connection is established.
  useEffect(() => {
    if (isConnected) void refreshReadiness();
  }, [isConnected, refreshReadiness]);

  const showAgentRequiredDialog = useCallback((reason: AgentReadinessReason | undefined) => {
    setAgentDialogReason(reason);
    setAgentDialogOpen(true);
  }, []);

  // Map an AGENT_NOT_READY error's details onto the dialog and re-check
  // readiness so the dialog reflects the latest backend state.
  const handleAgentNotReady = useCallback(
    (details?: unknown) => {
      showAgentRequiredDialog(agentReadinessReasonFromDetails(details));
      void refreshReadiness();
    },
    [showAgentRequiredDialog, refreshReadiness]
  );

  // Returns true if creation may proceed; otherwise opens the guidance dialog.
  // Refresh when readiness is unknown or currently unusable so first-load/null
  // readiness cannot fail open, while known-good state keeps the UI instant.
  const ensureAgentGate = useCallback(async (): Promise<boolean> => {
    await refreshReadiness();
    const latest = useAgentReadinessStore.getState().readiness;
    if (latest?.usable !== false) return true;
    showAgentRequiredDialog(latest.reason);
    return false;
  }, [refreshReadiness, showAgentRequiredDialog]);

  const runAfterAgentGate = useCallback(
    (action: () => void | Promise<void>, options?: { forceRefresh?: boolean }) => {
      if (!options?.forceRefresh && useAgentReadinessStore.getState().readiness?.usable === true) {
        void action();
        return;
      }
      void ensureAgentGate().then(ok => {
        if (ok) void action();
      });
    },
    [ensureAgentGate]
  );

  return {
    agentDialogOpen,
    agentDialogReason,
    setAgentDialogOpen,
    runAfterAgentGate,
    handleAgentNotReady,
  };
}
