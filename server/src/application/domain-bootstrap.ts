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
import { compactionCircuitBreaker } from './conversation/compaction/circuit-breaker.js';
import { registerPlatformRoutes } from './bootstrap/platform-routes.js';
import { TaskExecutorRegistry } from '../domains/tasks/executors/registry.js';
import { AgentTaskExecutor } from '../domains/tasks/executors/agent-executor.js';
import { CommandTaskExecutor } from '../domains/tasks/executors/command-executor.js';
import { TaskRepository } from '../domains/tasks/repository.js';
import { createAgentTaskRunner } from './orchestration/agent-task-runner.js';
import { SessionRepository } from '../domains/sessions/index.js';
import type { TaskExecutor } from '../domains/tasks/executors/types.js';
import { ensureSandboxInitialized } from '../infra/providers/pi-runtime/sandbox.js';
import { EvalTaskRuntime } from '../infra/providers/pi-runtime/eval-task-runtime.js';
import { GoalRepository, GoalService, GoalEvaluator, GoalCoordinator } from '../domains/goals/index.js';
import type { GoalEventPublisher } from '../domains/goals/types.js';
import { createGoalRoutes } from '../domains/goals/routes.js';
import { AnthropicEvaluatorPort } from '../domains/goals/ports/anthropic-evaluator-port.js';
import { SqliteTranscriptPort } from '../domains/goals/ports/sqlite-transcript-port.js';
import { ContinueTurnPortImpl } from '../domains/goals/ports/continue-turn-port.js';
import type { GoalStateChangedMessage, GoalEvaluatorVerdictMessage, GoalBudgetUpdateMessage } from '@zclaudia/shared';

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
  goalCoordinator: GoalCoordinator;
  goalService: GoalService;
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

  const backgroundTaskRepo = new TaskRepository(db);
  const commandTaskExecutor = new CommandTaskExecutor(backgroundTaskRepo);
  taskExecutorRegistry.register(commandTaskExecutor);
  commandTaskExecutor.reconcile();
  new EvalTaskRuntime(backgroundTaskRepo).reconcile();

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

  pluginEvents.on('session.deleted', (event: any) => {
    if (event?.sessionId) compactionCircuitBreaker.evict(event.sessionId);
  });

  registerInteractionDomain({ activeRuns, clients });

  void ensureSandboxInitialized().catch((err) => console.warn('[sandbox] startup init failed:', err));

  // ── Goals domain wiring ──
  const goalRepo = new GoalRepository(db as unknown as import('better-sqlite3').Database);

  // Real WebSocket event publisher — translates internal goal events to wire
  // messages and broadcasts to all authenticated clients.
  const goalEventPublisher: GoalEventPublisher = {
    publish: (event) => {
      if (event.type === 'goal:state-changed') {
        const wire: GoalStateChangedMessage = {
          type: 'goal:state-changed',
          sessionId: event.goal.sessionId,
          goal: event.goal,
        };
        clients.forEach((client) => {
          if (client.authenticated) sendMessage(client.ws, wire);
        });
      } else if (event.type === 'goal:evaluator-verdict') {
        const goal = goalRepo.findById(event.goalId);
        if (!goal) return;
        const wire: GoalEvaluatorVerdictMessage = {
          type: 'goal:evaluator-verdict',
          sessionId: goal.sessionId,
          goalId: event.goalId,
          kind: event.kind,
          reason: event.reason,
        };
        clients.forEach((client) => {
          if (client.authenticated) sendMessage(client.ws, wire);
        });
      } else if (event.type === 'goal:budget-update') {
        const goal = goalRepo.findById(event.goalId);
        if (!goal) return;
        const wire: GoalBudgetUpdateMessage = {
          type: 'goal:budget-update',
          sessionId: goal.sessionId,
          goalId: event.goalId,
          tokensUsed: event.tokensUsed,
          turnsUsed: event.turnsUsed,
        };
        clients.forEach((client) => {
          if (client.authenticated) sendMessage(client.ws, wire);
        });
      }
    },
  };

  const goalService = new GoalService(goalRepo, goalEventPublisher);

  // Mount goal REST routes under the sessions namespace.
  // Mounted after registerFeatureDomains; Express will fall through to this
  // handler when the session router has no match for /:id/goal sub-paths.
  app.use('/api/sessions/:id/goal', authMiddleware, createGoalRoutes(goalService));

  const evaluatorPort = new AnthropicEvaluatorPort();
  const goalEvaluator = new GoalEvaluator(evaluatorPort);
  const transcriptPort = new SqliteTranscriptPort(db as unknown as import('better-sqlite3').Database);

  const resolveSessionLlmProfileId = (sessionId: string): string | null => {
    const row = db
      .prepare(
        `SELECT ap.llm_profile_id AS llmProfileId
         FROM sessions s
         JOIN agent_profiles ap ON ap.id = s.agent_profile_id
         WHERE s.id = ?`,
      )
      .get(sessionId) as { llmProfileId: string | null } | undefined;
    return row?.llmProfileId ?? null;
  };

  const continueTurnPort = new ContinueTurnPortImpl({
    handleRunStart,
    db,
    clients,
    resolveLlmProfileId: resolveSessionLlmProfileId,
    resolveWorkingDirectory: (sessionId: string): string => {
      const row = db
        .prepare('SELECT working_directory, root_path FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.id = ?')
        .get(sessionId) as { working_directory: string | null; root_path: string | null } | undefined;
      return row?.working_directory ?? row?.root_path ?? process.cwd();
    },
  });
  const goalCoordinator = new GoalCoordinator({
    service: goalService,
    evaluator: goalEvaluator,
    transcript: transcriptPort,
    continuer: continueTurnPort,
    resolveLlmProfile: (sessionId: string): string => resolveSessionLlmProfileId(sessionId) ?? '',
  });

  return {
    supervisorService,
    notificationsService,
    permissionBridge,
    cancelWorkflowRun,
    permissionWorkflowResolver,
    metaWorkflowService,
    agentTaskExecutor,
    goalCoordinator,
    goalService,
  };
}
