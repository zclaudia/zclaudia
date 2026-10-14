import type { WorkflowAiRunPort } from '../../domains/workflows/index.js';
import type {
  AiRunPort,
  AiRunPortStartArgs,
} from '../../domains/meta-workflow/run-entities/subagent-run-entity.js';

/**
 * Adapt WorkflowAiRunPort → AiRunPort.
 *
 * WorkflowAiRunPort.startVirtualRun requires clientId/sessionId and uses
 * onMessage: (msg: ServerMessage). AiRunPort uses optional args and a simpler
 * onMessage shape. This adapter bridges the two by generating synthetic IDs
 * and re-mapping message shapes.
 */
export function createMetaWorkflowAiRunPort(workflowAiRunPort: WorkflowAiRunPort): AiRunPort {
  return {
    async startVirtualRun(args: AiRunPortStartArgs): Promise<void> {
      const clientId = args.clientId ?? `meta-virtual-${Date.now()}`;
      const sessionId = args.sessionId ?? `meta-session-${Date.now()}`;
      const result = workflowAiRunPort.startVirtualRun({
        clientId,
        sessionId,
        input: args.input,
        workingDirectory: args.workingDirectory,
        llmProfileId: args.llmProfileId,
        systemContext: args.systemContext,
        onMessage: msg => {
          if (!args.onMessage) return;
          const m = msg as { type?: string; kind?: string; content?: string; data?: unknown };
          // Map ServerMessage shape to AiRunPort's simpler {kind, content} shape.
          const kind = m.kind ?? m.type ?? 'unknown';
          const content = typeof m.content === 'string' ? m.content : undefined;
          args.onMessage({ kind, content });
        },
      });
      if (result instanceof Promise) await result;
    },
  };
}
