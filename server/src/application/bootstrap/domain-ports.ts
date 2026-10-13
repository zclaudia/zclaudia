import { createVirtualClient } from '../conversation/transport/types.js';
import { bumpProjectsVersion } from '../conversation/transport/broadcast.js';
import { getGatewayClient } from '../../infra/gateway/gateway-instance.js';
import { GatewayBackendDataPublisher } from '../../infra/gateway/gateway-backend-data-publisher.js';
import { publishLocalBackendDataEvent } from '../../infra/gateway/local-backend-data-events.js';
import type { BackendResourceEventMessage } from '@zclaudia/protocol/sync';
import type { RunLike } from '../../utils/run-state.js';
import type { ProjectChangeEvent } from '../../domains/projects/index.js';
import type { SessionEventPublisherPort } from '../../domains/sessions/index.js';
import type { LocalPRAiSessionPort } from '../../domains/local-pr/index.js';
import type { SupervisionAiRunPort } from '../../domains/supervision/index.js';
import type { WorkflowAiRunPort } from '../../domains/workflows/index.js';

interface CreateDomainPortsDeps {
  db: unknown;
  handleRunStart: (...args: any[]) => Promise<void>;
  broadcastHeartbeat: () => void;
  activeRuns: Map<string, RunLike>;
}

export interface DomainPorts {
  handleProjectChanged: (event?: ProjectChangeEvent) => void;
  sessionEvents: SessionEventPublisherPort;
  supervisionAiRunPort: SupervisionAiRunPort;
  localPrAiSessionPort: LocalPRAiSessionPort;
  workflowAiRunPort: WorkflowAiRunPort;
}

export function createDomainPorts(deps: CreateDomainPortsDeps): DomainPorts {
  const { db, handleRunStart, broadcastHeartbeat } = deps;
  const localDataPublisher = new GatewayBackendDataPublisher({
    activeRuns: deps.activeRuns,
    publishTopic: (_topic, payload) => {
      // This publisher only emits mutation events; snapshots are supplied by
      // LocalBackendHandler when the facade subscribes.
      publishLocalBackendDataEvent(payload as BackendResourceEventMessage);
    },
  });

  const handleProjectChanged = (event?: ProjectChangeEvent) => {
    bumpProjectsVersion();
    broadcastHeartbeat();

    if (!event) return;
    const gatewayClient = getGatewayClient();

    if (event.type === 'project_upsert') {
      localDataPublisher.broadcastProjectEvent('updated', event.project);
      gatewayClient?.commands.backendData.broadcastProjectEvent('updated', event.project);
    } else {
      localDataPublisher.broadcastProjectEvent('deleted', { id: event.projectId });
      gatewayClient?.commands.backendData.broadcastProjectEvent('deleted', { id: event.projectId });
    }
  };

  const sessionEvents: SessionEventPublisherPort = {
    publishSessionEvent: (type, session) => {
      localDataPublisher.broadcastSessionEvent(type, session);
      const gatewayClient = getGatewayClient();
      gatewayClient?.commands.backendData.broadcastSessionEvent(type, session);
    },
  };

  const supervisionAiRunPort: SupervisionAiRunPort = {
    startVirtualRun: async ({ clientId, sessionId, input, workingDirectory, onMessage }) => {
      const virtualClient = createVirtualClient(clientId, { send: onMessage });
      await handleRunStart(
        virtualClient,
        {
          type: 'run_start',
          clientRequestId: `${clientId}_${Date.now()}`,
          sessionId,
          input,
          workingDirectory,
        },
        db
      );
    },
  };

  const localPrAiSessionPort: LocalPRAiSessionPort = {
    startAISession: async ({
      clientId,
      sessionId,
      input,
      workingDirectory,
      llmProfileId,
      onMessage,
    }) => {
      const virtualClient = createVirtualClient(clientId, { send: onMessage });
      await handleRunStart(
        virtualClient,
        {
          type: 'run_start',
          clientRequestId: `${clientId}_${Date.now()}`,
          sessionId,
          input,
          workingDirectory,
          llmProfileId,
        },
        db
      );
    },
  };

  const workflowAiRunPort: WorkflowAiRunPort = {
    startVirtualRun: async ({
      clientId,
      sessionId,
      input,
      workingDirectory,
      llmProfileId,
      systemContext,
      onMessage,
    }) => {
      const virtualClient = createVirtualClient(clientId, { send: onMessage });
      await handleRunStart(
        virtualClient,
        {
          type: 'run_start',
          clientRequestId: clientId,
          sessionId,
          input,
          workingDirectory,
          llmProfileId,
          systemContext,
        },
        db
      );
    },
  };

  return {
    handleProjectChanged,
    sessionEvents,
    supervisionAiRunPort,
    localPrAiSessionPort,
    workflowAiRunPort,
  };
}
