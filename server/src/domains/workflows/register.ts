/**
 * Workflow domain registration.
 *
 * Assembles step executors (DI), wires engine + service, mounts routes.
 */

import type { Express } from 'express';
import type { RequestHandler } from 'express';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { initDatabase } from '../../infra/storage/db.js';
import { WorkflowEngine } from './engine.js';
import { WorkflowService } from './service.js';
import { WorkflowGeneratorService } from './generator.js';
import { createWorkflowRoutes } from './routes.js';
import type { NotificationSender } from '../../infra/push/notification-sender.js';
import type { WorkflowAiRunPort, WorkflowSchedulingPort } from './ports/runtime.js';
import { LightweightAgentRunner } from '../../infra/providers/pi-runtime/agent-loop/index.js';

import {
  CompositeStepExecutor,
  ShellStepExecutor,
  WebhookStepExecutor,
  NotifyStepExecutor,
  ConditionStepExecutor,
  WaitStepExecutor,
  AIPromptStepExecutor,
  DefaultWorkflowAgentRuntimeResolver,
  createWorkflowAgentPermissionCallbackFactory,
  AIReviewStepExecutor,
  GitStepExecutor,
  PluginStepExecutor,
  PermissionClassifyStepExecutor,
  AIRiskAnalysisStepExecutor,
  PermissionDecideStepExecutor,
  TaskWorkflowStepExecutor,
  ActivityStepExecutorAdapter,
} from './step-executors/index.js';
import type { ActivityRegistry } from '../activities/index.js';
import type { PermissionBridgePort } from './ports/step-executor.js';
import type { PermissionWorkflowResolver } from './permission-workflow-resolver.js';
import { TaskRepository } from '../tasks/repository.js';
import { TaskService } from '../tasks/task-service.js';
import { TaskExecutorRegistry } from '../tasks/executors/registry.js';

/** Minimal port for plugin step registry — avoids direct application/ import */
type WorkflowStepRegistryPort = import('./step-executors/plugin-executor.js').PluginStepRegistry & {
  getAllMeta(): Array<{ type: string; name: string; description: string; category: string; icon?: string; configSchema?: unknown }>;
};

/** Minimal port for plugin trigger registry */
interface WorkflowTriggerRegistryPort {
  getAll(): Array<unknown>;
}

export interface WorkflowDomainDeps {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  authMiddleware: RequestHandler;
  broadcast: (projectId: string | undefined, msg: ServerMessage | { type: string; [key: string]: unknown }) => void;
  notificationService: NotificationSender;
  workflowStepRegistry: WorkflowStepRegistryPort;
  workflowTriggerRegistry?: WorkflowTriggerRegistryPort;
  systemTaskRegistry: WorkflowSchedulingPort;
  aiRunPort: WorkflowAiRunPort;
  permissionBridge?: PermissionBridgePort;
  getPermissionWorkflowResolver?: () => PermissionWorkflowResolver | undefined;
  taskExecutorRegistry?: TaskExecutorRegistry;
  activityRegistry?: ActivityRegistry;
}

export interface WorkflowDomainResult {
  workflowService: WorkflowService;
  workflowGeneratorService: WorkflowGeneratorService;
  workflowEngine: WorkflowEngine;
}

export function registerWorkflowDomain(deps: WorkflowDomainDeps): WorkflowDomainResult {
  const { db, app, authMiddleware, broadcast, notificationService, workflowStepRegistry, workflowTriggerRegistry, aiRunPort, permissionBridge, getPermissionWorkflowResolver, activityRegistry } = deps;

  // -- Assemble step executors --
  const agentLoopRunner = new LightweightAgentRunner({ db });
  const agentRuntime = new DefaultWorkflowAgentRuntimeResolver(db, {
    permissionCallbackFactory: createWorkflowAgentPermissionCallbackFactory({
      db,
      permissionBridge,
      getPermissionWorkflowResolver,
    }),
  });
  const composite = new CompositeStepExecutor();

  composite.register(new ShellStepExecutor());
  composite.register(new WebhookStepExecutor());
  composite.register(new NotifyStepExecutor(notificationService));
  composite.register(new ConditionStepExecutor());
  composite.register(new AIPromptStepExecutor(agentLoopRunner, agentRuntime));
  composite.register(new AIReviewStepExecutor(agentLoopRunner));
  composite.register(new GitStepExecutor());
  composite.register(new TaskWorkflowStepExecutor(
    new TaskService(new TaskRepository(db)),
    deps.taskExecutorRegistry ?? new TaskExecutorRegistry(),
  ));
  composite.registerPlugin(new PluginStepExecutor(workflowStepRegistry));

  // -- Permission workflow step executors --
  composite.register(new PermissionClassifyStepExecutor());
  if (permissionBridge) {
    composite.register(new PermissionDecideStepExecutor(permissionBridge));
  }
  composite.register(new AIRiskAnalysisStepExecutor(agentLoopRunner));

  if (activityRegistry) {
    composite.register(new ActivityStepExecutorAdapter(activityRegistry, agentLoopRunner));
  }

  // -- Build engine --
  const engine = new WorkflowEngine(db, broadcast, composite);

  // WaitStepExecutor needs the engine (which implements ApprovalPort)
  composite.register(new WaitStepExecutor(engine));

  // -- Build service --
  const workflowService = new WorkflowService(db, broadcast, engine);
  workflowService.initialize();

  const workflowGeneratorService = new WorkflowGeneratorService(db, workflowStepRegistry, aiRunPort);

  // -- Mount routes --
  app.use('/api', authMiddleware, createWorkflowRoutes(workflowService, workflowGeneratorService, {
    stepRegistry: workflowStepRegistry,
    triggerRegistry: workflowTriggerRegistry,
  }));

  // Scheduling + event subscriptions are owned by AutomationService.

  return { workflowService, workflowGeneratorService, workflowEngine: engine };
}
