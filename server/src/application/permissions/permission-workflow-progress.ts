import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { WorkflowEngine, WorkflowService } from '../../domains/workflows/index.js';
import type { WorkflowRunEvent } from '../../domains/workflows/run-events.js';

interface PermissionWorkflowProgressDeps {
  /** Broadcast a wire message to all connected, authenticated clients. */
  broadcast: (message: ServerMessage | { type: string; [key: string]: unknown }) => void;
  workflowEngine: WorkflowEngine;
  workflowService: WorkflowService;
  clearPendingPermissionFromActiveRun: (requestId: string) => boolean;
}

/**
 * Permission workflow progress broadcasting.
 *
 * Subscribes to workflow engine events and translates them to
 * permission-specific wire messages, so the frontend can render live
 * progress for permission workflows (current step, completed steps,
 * AI review outcome, auto-resolution).
 */
export function registerPermissionWorkflowProgress(deps: PermissionWorkflowProgressDeps): void {
  const { broadcast, workflowEngine, workflowService, clearPendingPermissionFromActiveRun } = deps;

  workflowEngine.dispatcher.onAny((event: WorkflowRunEvent) => {
    const payload = workflowEngine.getRunEventPayload(event.runId);
    if (!payload?.requestId || !payload?.sessionId) return;

    const requestId = payload.requestId as string;
    const sessionId = payload.sessionId as string;

    if (
      event.type === 'step_started' ||
      event.type === 'step_completed' ||
      event.type === 'step_failed'
    ) {
      const runDetail = workflowService.getRun(event.runId);
      if (!runDetail) return;

      const completedSteps = runDetail.stepRuns
        .filter(s => s.status === 'completed')
        .map(s => s.stepId);

      broadcast({
        type: 'permission_workflow_progress',
        requestId,
        sessionId,
        workflowRunId: event.runId,
        currentStep: {
          id: event.stepId,
          type: runDetail.stepRuns.find(s => s.stepId === event.stepId)?.stepType || 'unknown',
          status:
            event.type === 'step_started'
              ? 'running'
              : event.type === 'step_completed'
                ? 'completed'
                : 'failed',
          label: runDetail.stepRuns.find(s => s.stepId === event.stepId)?.stepId || event.stepId,
        },
        completedSteps,
        totalSteps: runDetail.stepRuns.length,
      });

      // Send ai_review_completed when ai_risk_analysis step finishes
      if (event.type === 'step_completed') {
        const stepRun = runDetail.stepRuns.find(s => s.stepId === event.stepId);
        if (stepRun?.stepType === 'ai_risk_analysis' && stepRun.output) {
          broadcast({
            type: 'ai_review_completed',
            requestId,
            sessionId,
            decision: stepRun.output.decision || 'uncertain',
            reasoning: stepRun.output.reasoning || '',
            confidence: stepRun.output.confidence ?? 0,
            metadata: stepRun.output.metadata,
          });
        }

        // When permission_decide step resolves the permission, notify the frontend
        // and clean up pendingPermissions (mirrors what handlePermissionDecision does)
        if (stepRun?.stepType === 'permission_decide' && stepRun.output?.resolved) {
          // PermissionBridge normally broadcasts and clears the pending request
          // before releasing the provider. Keep this fallback for older/custom
          // bridge implementations that only resolve the promise.
          if (clearPendingPermissionFromActiveRun(requestId)) {
            const decision =
              stepRun.output.decision === 'allow' || stepRun.output.decision === 'approve'
                ? 'approve'
                : 'deny';
            broadcast({
              type: 'permission_auto_resolved',
              requestId,
              sessionId,
              behavior: decision,
              reason: (stepRun.output.reason as string) || 'Auto-resolved by permission workflow',
            });
          }
        }
      }
    }
  });
}
