/**
 * Domain registration and route mounting.
 *
 * Thin composition root for domain wiring and platform routes.
 */
import type { Express } from 'express';
import type { RequestHandler } from 'express';
import type { initDatabase } from '../infra/storage/db.js';
import { createFilesRoutes } from '../interfaces/http/files.js';
import { createCommandsRoutes } from '../interfaces/http/commands.js';
import { createAgentRoutes } from '../interfaces/http/agent.js';
import { createClaudiaRoutes } from '../interfaces/http/claudia.js';
import { createDelegationRoutes } from '../interfaces/http/delegation.js';
import type { NotificationService } from '../domains/notification-feed/index.js';
import type { ProcessSupervisor } from '../infra/services/process-supervisor.js';
import { systemTaskRegistry } from '../application/services/system-task-registry.js';
import type { SupervisorService } from '../domains/supervision/index.js';
import type { NotificationSender } from '../infra/push/notification-sender.js';
import { registerInteractionTools } from '../application/conversation/interactions/interaction-tools.js';
import { registerAgentTools } from '../application/conversation/agent-tools/index.js';
import { pluginEvents } from '../infra/events/index.js';
import { localOnlyMiddleware } from '../interfaces/http/middleware/local-only.js';
import { sendMessage } from '../application/conversation/transport/broadcast.js';
import { getNextOffset } from '../application/conversation/runtime/run-lifecycle.js';
import { createVirtualClient, type ConnectedClient, type ActiveRun } from '../application/conversation/transport/types.js';
import { registerInteractionDomain } from '../application/conversation/interactions/register.js';
import type { GatewayState } from '../infra/gateway/gateway-state.js';
import { createDomainPorts } from './bootstrap/domain-ports.js';
import { registerFeatureDomains } from './bootstrap/feature-domains.js';
import { recordActivity } from './conversation/memory/activity-log.js';
import { registerPlatformRoutes } from './bootstrap/platform-routes.js';
import { TaskExecutorRegistry } from '../domains/tasks/executors/registry.js';
import { AgentTaskExecutor } from '../domains/tasks/executors/agent-executor.js';
import { createAgentTaskRunner } from './orchestration/agent-task-runner.js';
import { SessionRepository } from '../domains/sessions/index.js';
import type { TaskExecutor } from '../domains/tasks/executors/types.js';

export interface BootstrapDeps {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  authMiddleware: RequestHandler;
  clients: Map<string, ConnectedClient>;
  activeRuns: Map<string, ActiveRun>;
  broadcastPluginState: () => void;
  broadcastHeartbeat: () => void;
  handleRunStart: (...args: any[]) => Promise<void>;
  getServerPort: () => number | null;
  notificationSender: NotificationSender;
  processSupervisor: ProcessSupervisor;
  gateway: GatewayState;
}

export interface BootstrapResult {
  supervisorService: SupervisorService;
  notificationsService: NotificationService;
  permissionBridge: import('./conversation/agent/permission-bridge.js').PermissionBridge;
  cancelWorkflowRun: (runId: string) => void;
  permissionWorkflowResolver: import('../domains/workflows/index.js').PermissionWorkflowResolver;
  metaWorkflowService: import('../domains/meta-workflow/service.js').MetaWorkflowService;
  agentTaskExecutor: TaskExecutor;
}

export function bootstrapDomains(deps: BootstrapDeps): BootstrapResult {
  const {
    db,
    app,
    authMiddleware,
    clients,
    activeRuns,
    broadcastPluginState,
    broadcastHeartbeat,
    handleRunStart,
    getServerPort,
    notificationSender,
    processSupervisor,
    gateway,
  } = deps;

  const {
    handleProjectChanged,
    sessionEvents,
    supervisionAiRunPort,
    localPrAiSessionPort,
    workflowAiRunPort,
  } = createDomainPorts({
    db,
    handleRunStart,
    broadcastHeartbeat,
  });
  const taskExecutorRegistry = new TaskExecutorRegistry();
  const sessionRepo = new SessionRepository(db);

  app.use('/api/files', authMiddleware, createFilesRoutes({
    sendMessage,
    getAuthenticatedClients: () => {
      const result: Array<{ ws: import('ws').WebSocket }> = [];
      clients.forEach((client) => {
        if (client.authenticated) {
          result.push({ ws: client.ws });
        }
      });
      return result;
    },
    db,
    getNextOffset: (sid: string) => getNextOffset(db, sid),
  }));
  app.use('/api/commands', authMiddleware, createCommandsRoutes({
    db,
    // Broadcast helper for command handlers that need to push wire-level
    // events (e.g. /compact emitting compaction_completed). Mirrors the
    // pattern in broadcastPluginState / broadcastHeartbeat — all authenticated
    // clients receive it; the client-side message dispatcher filters by
    // sessionId before applying.
    broadcast: (event) => {
      clients.forEach((client) => {
        if (client.authenticated) {
          sendMessage(client.ws, event);
        }
      });
    },
  }));
  app.use('/api/agent', authMiddleware, createAgentRoutes(db));
  app.use('/api/delegation', authMiddleware, createDelegationRoutes(db));
  app.use('/api/claudia', authMiddleware, createClaudiaRoutes(db));

  const {
    supervisorService,
    workflowEngine,
    notificationsService,
    permissionBridge,
    cancelWorkflowRun,
    permissionWorkflowResolver,
    metaWorkflowService,
  } = registerFeatureDomains({
    db,
    app,
    authMiddleware,
    clients,
    activeRuns,
    localOnlyMiddleware,
    broadcastPluginState,
    notificationSender,
    handleProjectChanged,
    sessionEvents,
    supervisionAiRunPort,
    localPrAiSessionPort,
    workflowAiRunPort,
    localPrScheduling: systemTaskRegistry,
    workflowScheduling: systemTaskRegistry,
    taskExecutorRegistry,
  });

  registerPlatformRoutes({
    app,
    db,
    authMiddleware,
    localOnlyMiddleware,
    processSupervisor,
    gateway,
    getServerPort,
    permissionWorkflowResolver,
  });

  registerInteractionTools({
    getServerPort,
  });

  registerAgentTools({
    getDb: () => db,
    getProcessSupervisor: () => processSupervisor,
  });

  import('../application/conversation/agent-tools/browser.js').then(m => m.registerBrowserTool());

  const agentTaskExecutor = new AgentTaskExecutor(createAgentTaskRunner({
    db,
    createVirtualClient,
    handleRunStart,
    getClients: () => clients,
    createSession: (opts) => sessionRepo.create({
      projectId: opts.projectId,
      name: opts.name,
      type: opts.type,
    } as any),
    sessionExists: (id) => !!sessionRepo.findById(id),
  }));
  taskExecutorRegistry.register(agentTaskExecutor);

  pluginEvents.on('run.completed', (event: any) => {
    try {
      const session = db.prepare('SELECT project_id FROM sessions WHERE id = ?').get(event.sessionId) as { project_id: string } | undefined;
      recordActivity(db, {
        projectId: session?.project_id ?? null,
        sessionId: event.sessionId,
        type: 'run_completed',
        summary: `Run completed (${event.usage?.output ?? 0} output tokens)`,
        metadata: { runId: event.runId, usage: event.usage },
      });
    } catch {
      // Activity log is best-effort, don't break run completion
    }
  });

  registerInteractionDomain({ activeRuns, clients });

  return {
    supervisorService,
    notificationsService,
    permissionBridge,
    cancelWorkflowRun,
    permissionWorkflowResolver,
    metaWorkflowService,
    agentTaskExecutor,
  };
}
