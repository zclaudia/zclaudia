import { Router, type Express, type RequestHandler } from 'express';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { initDatabase } from './infra/storage/db.js';
import type { ConnectedClient, ActiveRun } from './application/conversation/transport/types.js';
import { sendMessage } from './application/conversation/transport/broadcast.js';
import {
  registerProjectsDomain,
  ProjectRepository,
  type ProjectChangeEvent,
} from './domains/projects/index.js';
import {
  registerSessionsDomain,
  SessionRepository,
  buildTaskPlanningSession,
  buildTaskExecutingSessionPatch,
  buildTaskPlannedSessionPatch,
  buildTaskUnlockedSessionPatch,
  type SessionEventPublisherPort,
} from './domains/sessions/index.js';
import { requestSessionTitleGeneration } from './application/conversation/title/request-session-title.js';
import { registerLlmProfilesDomain, LlmProfileRepository } from './domains/llm-profiles/index.js';
import { registerLlmProfileRepository } from './domains/llm-profiles/repository-registry.js';
import { CodexOAuthSessionManager } from './domains/llm-profiles/codex-oauth-session.js';
import { createLlmProfileOauthRouter } from './interfaces/http/llm-profile-oauth.js';
import { registerAgentProfilesDomain } from './domains/agent-profiles/index.js';
import { pluginLoader } from './application/plugins/loader.js';
import { registerRuntimeRoutes } from './interfaces/http/providers/runtime-routes.js';
import { mountSessionInvocableRoutes } from './interfaces/http/session-invocables.js';
import { buildSessionCatalogRequest } from './application/invocations/session-catalog.js';
import { providerRegistry } from './infra/providers/registry.js';
import { createManagedRuntimeRoutes } from './application/managed-runtimes/routes.js';
import { managedRuntimeService } from './application/managed-runtimes/service.js';
import { registerNotificationDomain } from './domains/notification-feed/index.js';
import {
  registerSupervisionDomain,
  type SupervisorService,
  type SupervisionAiRunPort,
  type SupervisionProjectPort,
  type SupervisionSessionPort,
  type SupervisionSessionModelPort,
} from './domains/supervision/index.js';
import {
  registerLocalPRDomain,
  type LocalPRAiSessionPort,
  type LocalPRSchedulingPort,
} from './domains/local-pr/index.js';
import { registerLocalIssueDomain } from './domains/local-issues/index.js';
import { registerTurnSummaryDomain } from './domains/turn-summaries/index.js';
import { registerAttachmentDomain } from './domains/attachments/index.js';
import {
  registerWorkflowDomain,
  WorkflowRunRepository,
  type WorkflowService,
  type WorkflowEngine,
  type WorkflowAiRunPort,
  type WorkflowSchedulingPort,
} from './domains/workflows/index.js';
import { PermissionWorkflowResolver } from './domains/workflows/index.js';
import { registerMetaWorkflow } from './domains/meta-workflow/register.js';
import type { MetaWorkflowService } from './domains/meta-workflow/service.js';
import { createWorktreeAllocatorFromSupervisor } from './application/bootstrap/meta-workflow-allocator.js';
import { registerPluginsDomain } from './application/plugins/register.js';
import {
  toolRegistry,
  workflowStepRegistry,
  workflowTriggerRegistry,
} from './application/plugins/index.js';
import type { AutomationService } from './domains/automations/service.js';
import { registerAutomationsDomain } from './domains/automations/index.js';
import type { NotificationSender } from './infra/push/notification-sender.js';
import type { NotificationService } from './domains/notification-feed/index.js';
import { PermissionBridge } from './application/conversation/agent/permission-bridge.js';
import {
  ExecutorRegistry,
  ManualAdapter,
  ExecutorInstanceRepository,
} from './domains/executor/index.js';
import { ClassicAdapter } from './domains/executor/adapters/classic-adapter.js';
import { MetaWorkflowAdapter } from './domains/executor/adapters/meta-workflow-adapter.js';
import { SpecChangeRepository } from './domains/spec-change/spec-change-repository.js';
import {
  SpecChangeService,
  ArchiveService,
  AiExploreService,
  BootstrapService,
  BootstrapReviewService,
  SpecChangeDraftingService,
  BootstrapScanRepository,
} from './domains/openspec/index.js';
import { BootstrapCandidateRepository } from './domains/openspec/repositories/bootstrap-candidate-repository.js';
import {
  registerIssueOrchestration,
  type IssueOrchestration,
} from './domains/issue-orchestration/index.js';
import { createCorpusRoutes } from './domains/openspec/routes/corpus-routes.js';
import { createSpecChangeRoutes } from './domains/openspec/routes/spec-change-routes.js';
import { createBootstrapRoutes } from './domains/openspec/routes/bootstrap-routes.js';
import { createExecutorRoutes } from './domains/executor/routes.js';
import { createIssueRoutes } from './domains/issue-orchestration/routes.js';
import { createEpicRoutes } from './domains/epics/routes.js';
import { EpicService } from './domains/epics/service.js';
import { type TaskExecutorRegistry } from './domains/tasks/executors/registry.js';
import {
  ActivityRegistry,
  GitCommitActivity,
  GitStageActivity,
  GenerateCommitMessageActivity,
} from './domains/activities/index.js';
import { createPiAgentLoopRunner } from './application/agent-loop/lightweight-agent-runner.js';
import { DefaultWorkflowAgentRuntimeResolver } from './application/workflows/workflow-agent-runtime-resolver.js';
import { createMetaWorkflowAiRunPort } from './application/workflows/meta-workflow-ai-port.js';
import { createTaskAdapter } from './application/tasks/task-adapter.js';
import { createPlanModePort } from './application/conversation/runtime/plan-mode-port.js';
import { clearPendingPermissionFromActiveRun as clearPendingPermissionFromActiveRunIn } from './application/permissions/clear-pending-permission.js';
import { registerPermissionWorkflowProgress } from './application/permissions/permission-workflow-progress.js';
import { getProjectRoot as lookupProjectRoot } from './application/bootstrap/project-root.js';

interface RegisterFeatureDomainsDeps {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  authMiddleware: RequestHandler;
  clients: Map<string, ConnectedClient>;
  activeRuns: Map<string, ActiveRun>;
  localOnlyMiddleware: RequestHandler;
  broadcastPluginState: () => void;
  notificationSender: NotificationSender;
  handleProjectChanged: (event?: ProjectChangeEvent) => void;
  sessionEvents: SessionEventPublisherPort;
  supervisionAiRunPort: SupervisionAiRunPort;
  localPrAiSessionPort: LocalPRAiSessionPort;
  workflowAiRunPort: WorkflowAiRunPort;
  localPrScheduling: LocalPRSchedulingPort;
  workflowScheduling: WorkflowSchedulingPort;
  taskExecutorRegistry?: TaskExecutorRegistry;
}

export interface FeatureDomainsResult {
  supervisorService: SupervisorService;
  workflowService: WorkflowService;
  workflowEngine: WorkflowEngine;
  notificationsService: NotificationService;
  permissionBridge: PermissionBridge;
  cancelWorkflowRun: (runId: string) => void;
  permissionWorkflowResolver: PermissionWorkflowResolver;
  automationService: AutomationService;
  metaWorkflowService: MetaWorkflowService;
  executorRegistry: ExecutorRegistry;
  executorInstanceRepo: ExecutorInstanceRepository;
  specChangeRepo: SpecChangeRepository;
  specChangeService: SpecChangeService;
  archiveService: ArchiveService;
  issueOrchestration: IssueOrchestration;
  aiExploreService: AiExploreService;
  bootstrapService: BootstrapService;
  bootstrapReviewService: BootstrapReviewService;
  specChangeDraftingService: SpecChangeDraftingService;
}

function broadcastToAuthenticatedClients(
  clients: Map<string, ConnectedClient>,
  message: ServerMessage | { type: string; [key: string]: unknown }
): void {
  clients.forEach(client => {
    if (client.authenticated) {
      sendMessage(client.ws, message as ServerMessage);
    }
  });
}

export function registerFeatureDomains(deps: RegisterFeatureDomainsDeps): FeatureDomainsResult {
  const {
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
    localPrScheduling,
    workflowScheduling,
    taskExecutorRegistry,
  } = deps;

  const activityRegistry = new ActivityRegistry();
  activityRegistry.register(new GitCommitActivity());
  activityRegistry.register(new GitStageActivity());
  activityRegistry.register(new GenerateCommitMessageActivity());
  const sharedAgentLoopRunner = createPiAgentLoopRunner(db, {
    taskPort: createTaskAdapter(db),
    planModePort: createPlanModePort(db),
  });

  registerProjectsDomain({
    db,
    app,
    authMiddleware,
    onProjectChanged: handleProjectChanged,
    activityRegistry,
    agentLoopRunner: sharedAgentLoopRunner,
  });
  registerSessionsDomain({
    app,
    authMiddleware,
    db,
    activeRuns,
    sessionEvents,
    requestTitleGeneration: requestSessionTitleGeneration,
    managedRuntimes: managedRuntimeService,
  });
  // URIP session invocable catalog (§15.1): host actions + runtime + portable
  // entries composed per session. Snapshot building wires to the live session
  // context as runtime adapters publish catalogs; the routes exist now so the
  // desktop consumes session-scoped catalogs, never provider-type ones.
  // (Mounted here — the composition root — so the sessions domain does not
  // import the interfaces/application layers.)
  const sessionInvocablesRouter = Router();
  mountSessionInvocableRoutes(sessionInvocablesRouter, db, {
    buildRequest: (database, sessionId) =>
      buildSessionCatalogRequest(database, sessionId, providerRegistry),
  });
  app.use('/api/sessions', authMiddleware, sessionInvocablesRouter);
  registerLlmProfilesDomain({ app, authMiddleware, db });

  // Wire the LlmProfileRepository into the registry so build-model.ts can
  // call getLlmProfileWriter() during chat requests (T7 cross-task dependency).
  const llmProfileRepo = new LlmProfileRepository(db);
  registerLlmProfileRepository(llmProfileRepo);

  // Mount OAuth flow and codex-models endpoints
  const codexOauthSessions = new CodexOAuthSessionManager({
    updateOAuthCredentials: (profileId, creds) => {
      if (creds === null) {
        llmProfileRepo.clearOAuthCredentials(profileId);
      } else {
        llmProfileRepo.update(profileId, { oauthCredentials: creds });
      }
    },
  });
  app.use(
    '/api/llm-profiles',
    authMiddleware,
    createLlmProfileOauthRouter(llmProfileRepo, codexOauthSessions)
  );

  registerAgentProfilesDomain({
    app,
    authMiddleware,
    db,
    // Built-in plugin runtime contributions (claude ships as a plugin); read
    // via the loader here in the composition root, evaluated per request.
    builtinRuntimeContributions: () =>
      pluginLoader
        .getPlugins()
        .filter(plugin => pluginLoader.isBuiltin(plugin.manifest.id))
        .flatMap(plugin => plugin.manifest.contributes?.agentRuntimes ?? []),
  });
  // Managed runtime routes stay mounted here (composition root) so the
  // agent-profiles domain does not import the application layer.
  app.use('/api/managed-runtimes', authMiddleware, createManagedRuntimeRoutes(localOnlyMiddleware));
  registerRuntimeRoutes({ app, authMiddleware, db, toolRegistry });

  const { notificationService: notificationsService } = registerNotificationDomain({
    db,
    app,
    authMiddleware,
    broadcastMessage: msg => broadcastToAuthenticatedClients(clients, msg),
    notificationSender,
  });

  const svProjectRepo = new ProjectRepository(db);
  const svSessionRepo = new SessionRepository(db);

  const supervisionProjectPort: SupervisionProjectPort = {
    findById: id => svProjectRepo.findById(id) ?? undefined,
    findAll: () => svProjectRepo.findAll(),
    update: (id, data) =>
      svProjectRepo.update(id, {
        ...data,
        agent: data.agent === null ? undefined : data.agent,
      }),
  };
  const supervisionSessionPort: SupervisionSessionPort = {
    findById: id => svSessionRepo.findById(id) ?? undefined,
    create: data => svSessionRepo.create(data),
    update: (id, data) => svSessionRepo.update(id, data),
    findByProjectRole: (projectId, role) => svSessionRepo.findByProjectRole(projectId, role),
  };
  const supervisionSessionModel: SupervisionSessionModelPort = {
    buildTaskPlanningSession,
    buildTaskExecutingSessionPatch,
    buildTaskPlannedSessionPatch,
    buildTaskUnlockedSessionPatch,
  };

  const { supervisorService } = registerSupervisionDomain({
    db,
    app,
    authMiddleware,
    broadcast: msg => broadcastToAuthenticatedClients(clients, msg),
    activeRuns,
    aiRunPort: supervisionAiRunPort,
    systemTaskRegistry: localPrScheduling,
    projectPort: supervisionProjectPort,
    sessionPort: supervisionSessionPort,
    sessionModel: supervisionSessionModel,
  });

  registerLocalPRDomain({
    db,
    app,
    authMiddleware,
    broadcast: (_projectId, msg) => broadcastToAuthenticatedClients(clients, msg),
    onProjectChanged: handleProjectChanged,
    isWorktreeAvailable: projectId => {
      const pool = supervisorService.getWorktreePoolIfExists(projectId);
      if (!pool) return true;
      return pool.getStatus().available > 0;
    },
    startAISession: localPrAiSessionPort.startAISession,
    scheduling: localPrScheduling,
  });

  // Attachments must be registered before any domain that delegates cascade
  // cleanup to it (e.g. local issues calling attachmentService.deleteByOwner).
  const { attachmentService } = registerAttachmentDomain({
    db,
    app,
    authMiddleware,
    broadcast: msg => broadcastToAuthenticatedClients(clients, msg),
  });

  registerLocalIssueDomain({
    db,
    app,
    authMiddleware,
    broadcast: (_projectId, msg) => broadcastToAuthenticatedClients(clients, msg),
    hooks: {
      onDelete: issueId => {
        attachmentService.deleteByOwner('local_issue', issueId);
      },
    },
  });

  registerTurnSummaryDomain({
    db,
    app,
    authMiddleware,
  });

  // Permission bridge — connects workflow engine to conversation permission system
  const clearPendingPermissionFromActiveRun = (requestId: string): boolean =>
    clearPendingPermissionFromActiveRunIn(activeRuns, requestId);

  const permissionBridge = new PermissionBridge({
    onWorkflowResolved: ({ requestId, decision, reason, context }) => {
      broadcastToAuthenticatedClients(clients, {
        type: 'permission_auto_resolved',
        requestId,
        sessionId: context.sessionId,
        behavior: decision === 'allow' ? 'approve' : 'deny',
        reason: reason || 'Auto-resolved by permission workflow',
      });
      clearPendingPermissionFromActiveRun(requestId);
    },
  });

  const permissionWorkflowResolverRef: { current?: PermissionWorkflowResolver } = {};

  const { workflowService, workflowEngine } = registerWorkflowDomain({
    db,
    app,
    authMiddleware,
    broadcast: (_projectId, msg) => broadcastToAuthenticatedClients(clients, msg),
    notificationService: notificationSender,
    workflowStepRegistry,
    workflowTriggerRegistry,
    systemTaskRegistry: workflowScheduling,
    aiRunPort: workflowAiRunPort,
    permissionBridge,
    agentRuntime: DefaultWorkflowAgentRuntimeResolver.withWorkflowPermissions(db, {
      db,
      permissionBridge,
      getPermissionWorkflowResolver: () => permissionWorkflowResolverRef.current,
    }),
    taskExecutorRegistry,
    activityRegistry,
    agentLoopRunner: sharedAgentLoopRunner,
    projectLookup: new ProjectRepository(db),
  });
  const permissionWorkflowResolver = new PermissionWorkflowResolver(db, workflowService);
  permissionWorkflowResolverRef.current = permissionWorkflowResolver;

  const { automationService } = registerAutomationsDomain({
    db,
    app,
    authMiddleware,
    broadcast: (_projectId, msg) => broadcastToAuthenticatedClients(clients, msg),
    engine: workflowEngine,
    workflows: { getWorkflow: id => workflowService.getWorkflow(id) },
    systemTaskRegistry: workflowScheduling,
  });

  // Reconcile the system permission automation against the system workflow.
  automationService.ensureSystemAutomations(workflowService.getSystemPermissionFallback().id);

  // ── Permission workflow progress broadcasting ──
  // Subscribe to workflow engine events and translate to permission-specific messages.
  registerPermissionWorkflowProgress({
    broadcast: msg => broadcastToAuthenticatedClients(clients, msg),
    workflowEngine,
    workflowService,
    clearPendingPermissionFromActiveRun,
  });

  // Callback for cancelling a workflow run (used when user manually decides a permission)
  const cancelWorkflowRun = (runId: string): void => {
    workflowService.cancelRun(runId);
  };

  // ── Meta Workflow domain ──
  // defaultProjectId: use the first project in the database for Phase D MVP.
  // Phase E will wire per-run projectId through the full call stack.
  // TODO(Phase E): remove this fallback once per-run project context is available.
  const defaultProjectId = svProjectRepo.findAll()[0]?.id ?? 'default';
  const workflowRunRepository = new WorkflowRunRepository(db);

  // Adapt WorkflowAiRunPort → AiRunPort for meta-workflow virtual runs
  // (see application/workflows/meta-workflow-ai-port.ts).
  const metaWorkflowAiRunPort = createMetaWorkflowAiRunPort(workflowAiRunPort);

  const metaWorkflow = registerMetaWorkflow({
    db,
    workflowEngine,
    workflowRunRepository,
    aiRunPort: metaWorkflowAiRunPort,
    worktreeAllocator: createWorktreeAllocatorFromSupervisor(supervisorService, defaultProjectId),
    defaultProjectId,
  });
  app.use('/api/meta-workflow', authMiddleware, metaWorkflow.routes);

  registerPluginsDomain({
    app,
    authMiddleware,
    localOnlyMiddleware,
    db,
    activeRuns,
    clients,
    broadcastPluginState,
  });

  // ── G1: OpenSpec foundation registries (no-op for existing flows) ──
  // Constructs an ExecutorRegistry and registers the three adapter factories
  // (manual / classic / meta-workflow). Downstream phases (G3+) will resolve
  // executors via this registry; for G1 the wiring is purely structural so
  // existing flows keep working unchanged. 'superpowers' is deliberately
  // omitted here — G6+ may add it.
  const executorRegistry = new ExecutorRegistry();
  const executorInstanceRepo = new ExecutorInstanceRepository(db);
  const specChangeRepo = new SpecChangeRepository(db);
  const changeLifecycle = supervisorService.getChangeLifecycle();
  const metaWorkflowService = metaWorkflow.service;

  executorRegistry.register('manual', instance => new ManualAdapter(db, instance));
  executorRegistry.register(
    'classic',
    instance => new ClassicAdapter(db, changeLifecycle, instance)
  );
  executorRegistry.register(
    'meta-workflow',
    instance => new MetaWorkflowAdapter(db, metaWorkflowService, instance)
  );

  // ── G2/G3: OpenSpec SpecChange / Archive services + Issue orchestration ──
  // Wires SpecChangeService, ArchiveService, and the full issue-orchestration
  // bag (ExecutorService + IssueLifecycle + IssueStatusPropagator +
  // AnonymousIssueService) and installs the propagator subscriber.
  //
  // G5a: real project root lookup. Returns the projects.root_path string.
  // (lookup itself lives in application/bootstrap/project-root.ts; throws if
  // project is missing or has no root_path configured.)
  const getProjectRoot = (projectId: string): string => lookupProjectRoot(db, projectId);
  const specChangeService = new SpecChangeService({
    db,
    getProjectRoot,
  });
  const archiveService = new ArchiveService({
    db,
    getProjectRoot,
  });
  const issueOrchestration = registerIssueOrchestration({
    db,
    registry: executorRegistry,
    specChangeService,
    archiveService,
    broadcast: (_projectId, msg) => broadcastToAuthenticatedClients(clients, msg),
  });

  // ── G4: OpenSpec bootstrap services ──
  // Reuses `metaWorkflowAiRunPort` (same AiRunPort shape) so the explore
  // workflow goes through the same virtual-run plumbing as meta-workflow.
  // Uses the G5a `getProjectRoot` lookup defined above.
  const aiExploreService = new AiExploreService({ aiRunPort: metaWorkflowAiRunPort });
  const bootstrapScanRepo = new BootstrapScanRepository(db);
  const bootstrapService = new BootstrapService({
    db,
    explore: aiExploreService,
    getProjectRoot,
    broadcast: (scanId, payload) => {
      const scan = bootstrapScanRepo.findById(scanId);
      if (!scan) return;
      broadcastToAuthenticatedClients(clients, {
        type: 'bootstrap_event',
        scanId,
        projectId: scan.projectId,
        payload,
      });
    },
  });
  const bootstrapReviewService = new BootstrapReviewService({
    db,
    getProjectRoot,
  });

  // ── G7: SpecChange AI drafting service ──
  // Reuses `metaWorkflowAiRunPort` (same AiRunPort shape used by G4 explore).
  // Each draft method reads sub-issue + existing artifacts as context, calls
  // the AI, and returns the drafted markdown. Routes (Task 2) auto-save to disk.
  const specChangeDraftingService = new SpecChangeDraftingService({
    db,
    aiRunPort: metaWorkflowAiRunPort,
    getProjectRoot,
  });

  // ── G5a: Mount REST routes for OpenSpec + issue orchestration ──
  // Multiple `app.use('/api/openspec', ...)` mounts share the path prefix —
  // Express dispatches to each router based on its own sub-paths.
  app.use('/api/openspec', authMiddleware, createCorpusRoutes({ getProjectRoot }));
  app.use(
    '/api/openspec',
    authMiddleware,
    createSpecChangeRoutes({ db, specChangeService, draftingService: specChangeDraftingService })
  );
  app.use(
    '/api/openspec',
    authMiddleware,
    createExecutorRoutes({ db, executorService: issueOrchestration.executorService })
  );
  app.use(
    '/api/openspec',
    authMiddleware,
    createBootstrapRoutes({
      db,
      bootstrapService,
      reviewService: bootstrapReviewService,
      candidateRepo: new BootstrapCandidateRepository(db),
      scanRepo: bootstrapScanRepo,
    })
  );
  app.use(
    '/api/issues',
    authMiddleware,
    createIssueRoutes({
      lifecycle: issueOrchestration.lifecycle,
      anonymousService: issueOrchestration.anonymousService,
    })
  );
  app.use('/api/epics', authMiddleware, createEpicRoutes({ service: new EpicService(db) }));

  return {
    supervisorService,
    workflowService,
    workflowEngine,
    notificationsService,
    permissionBridge,
    cancelWorkflowRun,
    permissionWorkflowResolver,
    automationService,
    metaWorkflowService,
    executorRegistry,
    executorInstanceRepo,
    specChangeRepo,
    specChangeService,
    archiveService,
    issueOrchestration,
    aiExploreService,
    bootstrapService,
    bootstrapReviewService,
    specChangeDraftingService,
  };
}
