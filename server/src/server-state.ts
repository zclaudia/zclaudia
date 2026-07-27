/**
 * ServerState — centralized mutable state for the server process.
 *
 * Replaces the module-level `let` variables and context-factory closures
 * previously scattered across server.ts.  All state reads and writes go
 * through the singleton exported below, making dependencies explicit and
 * the code easier to test.
 */

import type {
  BranchAction,
  BrowserEngineStatusMessage,
  ClaudiaTaskSnapshotMessage,
  ClaudiaTaskStatus,
  ClaudiaTaskUpdateMessage,
  StateHeartbeatMessage,
} from '@zclaudia/shared/wire/messages';
import type { TaskRecord } from '@zclaudia/shared/core/task';
import type { initDatabase } from './infra/storage/db.js';
import type { ProcessMonitor } from './utils/process-monitor.js';
import type { NotificationSender } from './infra/push/notification-sender.js';
import type { PermissionBridge } from './application/conversation/agent/permission-bridge.js';
import type { PermissionWorkflowResolver } from './domains/workflows/index.js';
import type { NotificationService } from './domains/notification-feed/index.js';
import type { MetaWorkflowService } from './domains/meta-workflow/service.js';
import type { GoalCoordinator } from './domains/goals/coordinator.js';
import type { GoalService } from './domains/goals/service.js';
import type { FacadeWsHub } from './infra/gateway/ws-hub.js';
import type { TaskCoordinationPort } from './application/conversation/task-coordination-port.js';
import type { SessionSyncPort } from './application/conversation/session-sync-port.js';
import type { TaskExecutor } from './domains/tasks/executors/types.js';
import type { MessageHandlerContext } from './application/conversation/transport/message-handler.js';
import type { RunHandlerContext } from './application/conversation/runtime/run-handler.js';
import type { ConnectedClient, ActiveRun } from './application/conversation/transport/types.js';
import type { BrowserManager } from './application/browser/browser-manager.js';
import { ClaudiaBranchService } from './application/orchestration/claudia-branch-service.js';
import { getGatewayClient } from './infra/gateway/gateway-instance.js';
import { providerRegistry } from './infra/providers/registry.js';
import {
  buildStateHeartbeat as _buildStateHeartbeat,
  broadcastHeartbeat as _broadcastHeartbeat,
  broadcastPluginState as _broadcastPluginState,
  sendMessage,
} from './application/conversation/transport/broadcast.js';
import { findProcessPidsByTaskCommand } from './application/conversation/runtime/run-lifecycle.js';
import { TaskRepository } from './domains/tasks/repository.js';
import { TaskService } from './domains/tasks/task-service.js';

export class ServerState {
  // --- Core state ---
  database: ReturnType<typeof initDatabase> | null = null;
  readonly activeRuns = new Map<string, ActiveRun>();
  connectedClients = new Map<string, ConnectedClient>();

  // --- Infrastructure references (set during createServer) ---
  processMonitor: ProcessMonitor | null = null;
  notificationSender: NotificationSender | null = null;
  serverPort: number | null = null;
  facadeHubRef: FacadeWsHub | null = null;

  // --- Service references (set after setupRoutesAndServices) ---
  notificationsService: NotificationService | undefined;
  permissionBridge: PermissionBridge | undefined;
  cancelWorkflowRun: ((runId: string) => void) | undefined;
  permissionWorkflowResolver: PermissionWorkflowResolver | undefined;
  branchAllocator: ClaudiaBranchService | undefined;
  metaWorkflowService: MetaWorkflowService | undefined;
  agentTaskExecutor: TaskExecutor | undefined;
  goalCoordinator: GoalCoordinator | undefined;
  goalService: GoalService | undefined;
  browserManager: BrowserManager | undefined;
  installBrowserEngineFn:
    | ((notify: (msg: BrowserEngineStatusMessage) => void) => Promise<void>)
    | undefined;

  // --- Broadcast wrappers ---

  broadcastHeartbeat(): void {
    _broadcastHeartbeat(this.connectedClients, this.activeRuns);
  }

  broadcastPluginState(): void {
    _broadcastPluginState(this.connectedClients);
  }

  broadcastBrowserEngineStatus(msg: BrowserEngineStatusMessage): void {
    for (const client of this.connectedClients.values()) {
      if (client.authenticated) sendMessage(client.ws, msg);
    }
  }

  buildStateHeartbeat(): StateHeartbeatMessage {
    const heartbeat = _buildStateHeartbeat(this.activeRuns);
    heartbeat.unreadFeedCount = this.notificationsService?.getUnreadCount() ?? 0;
    heartbeat.unreadFeedCountsByTab = this.notificationsService?.getUnreadCountsByTab();
    return heartbeat;
  }

  // --- Context factories ---

  getTaskCoordination(): TaskCoordinationPort | undefined {
    const alloc = this.branchAllocator;
    const db = this.database;
    const agentTaskExecutor = this.agentTaskExecutor;
    if (!db || !alloc || !agentTaskExecutor) return undefined;
    const parseMetadata = (
      taskId: string
    ): { task: TaskRecord; metadata: Record<string, unknown> } | undefined => {
      if (!db) return undefined;
      const task = new TaskRepository(db).findById(taskId);
      if (!task || task.type !== 'agent') return undefined;
      return { task, metadata: task.metadata ?? {} };
    };
    const metadataString = (metadata: Record<string, unknown>, key: string): string | undefined => {
      const value = metadata[key];
      return typeof value === 'string' && value.trim() ? value : undefined;
    };
    const startCanonicalAgentTask = async (input: {
      parentTaskId?: string;
      taskInput: string;
      title: string;
      projectId: string;
      llmProfileId?: string;
      branchId: string;
      branchAction: BranchAction;
      contextReset?: boolean;
    }) => {
      if (!db || !agentTaskExecutor)
        throw new Error('Canonical agent task runtime is not available');
      const taskService = new TaskService(new TaskRepository(db));
      const task = taskService.createTask({
        type: 'agent',
        title: input.title,
        description: input.taskInput,
        parentTaskId: input.parentTaskId,
        metadata: {
          initiator: 'claudia',
          projectId: input.projectId,
          llmProfileId: input.llmProfileId,
          branchId: input.branchId,
          branchAction: input.branchAction,
          contextReset: Boolean(input.contextReset),
          input: input.taskInput,
          prompt: input.taskInput,
        },
      });
      const started = await agentTaskExecutor.start(task);
      const running = taskService.startTask(task.id, {
        executorRef: started.executorRef,
        sessionId: started.sessionId,
      });
      void agentTaskExecutor
        .wait(task.id)
        .then(update => {
          const repo = new TaskRepository(db);
          const service = new TaskService(repo);
          let updated = repo.findById(task.id);
          if (
            !updated ||
            updated.status === 'completed' ||
            updated.status === 'failed' ||
            updated.status === 'stopped'
          )
            return;
          if (update.status === 'completed') {
            updated = service.completeTask(task.id, update.result ?? {});
          } else if (update.status === 'stopped') {
            updated = service.stopTask(task.id, update.result);
          } else {
            updated = service.failTask(task.id, update.result ?? { error: 'Agent task failed' });
          }
          const metadata = updated.metadata ?? {};
          const result = updated.result ?? {};
          const text = typeof result.text === 'string' ? result.text : undefined;
          const error = typeof result.error === 'string' ? result.error : undefined;
          const branchId = typeof metadata.branchId === 'string' ? metadata.branchId : undefined;
          const branchAction =
            typeof metadata.branchAction === 'string' ? metadata.branchAction : undefined;
          const contextReset =
            typeof metadata.contextReset === 'boolean' ? metadata.contextReset : undefined;
          const wireStatus = (
            updated.status === 'stopped' ? 'cancelled' : updated.status
          ) as ClaudiaTaskStatus;
          for (const [, client] of this.connectedClients) {
            if (client.authenticated) {
              const updateMessage: ClaudiaTaskUpdateMessage = {
                type: 'claudia_task_update',
                taskId: updated.id,
                status: wireStatus,
                sessionId: updated.sessionId ?? undefined,
                branchId,
                branchAction: branchAction as BranchAction | undefined,
                contextReset,
                title: updated.title,
                summary: text,
                error,
                responseText: text,
                updatedAt: updated.updatedAt,
              };
              sendMessage(client.ws, updateMessage);
            }
          }
          const feedItem = this.notificationsService?.findByTaskId(task.id);
          if (feedItem) {
            this.notificationsService?.updateItemStatus(
              feedItem.id,
              updated.status === 'completed' ? 'completed' : 'failed',
              { summary: text, error }
            );
          }
        })
        .catch((err: unknown) => {
          console.error(
            `[TaskCoordination] Failed to settle canonical Claudia task ${task.id}:`,
            err
          );
        });
      return { taskId: task.id, sessionId: running.sessionId ?? '' };
    };
    return {
      allocateBranch: opts => alloc.allocateBranch(opts),
      allocateForContinue: opts => alloc.allocateForContinue(opts),
      setActiveBranchId: (hostProjectId, branchId) =>
        alloc.setActiveBranchId(hostProjectId, branchId),
      attachSession: (branchId, sessionId) => alloc.attachSession(branchId, sessionId),
      updateBranchTask: (branchId, taskId, sessionId) =>
        alloc.updateBranchTask(branchId, taskId, sessionId),
      submitCanonicalAgentTask: async input => {
        return startCanonicalAgentTask({
          taskInput: input.input,
          title: input.title,
          projectId: input.projectId,
          llmProfileId: input.llmProfileId,
          branchId: input.branchId,
          branchAction: input.branchAction,
          contextReset: input.contextReset,
        });
      },
      getCanonicalAgentTask: taskId => {
        const found = parseMetadata(taskId);
        if (!found || found.metadata.initiator !== 'claudia') return undefined;
        return {
          taskId: found.task.id,
          projectId: metadataString(found.metadata, 'projectId') ?? null,
          branchId: metadataString(found.metadata, 'branchId') ?? null,
          llmProfileId: metadataString(found.metadata, 'llmProfileId'),
        };
      },
      continueCanonicalAgentTask: async input => {
        return startCanonicalAgentTask({
          parentTaskId: input.parentTaskId,
          taskInput: input.input,
          title: input.title,
          projectId: input.projectId,
          llmProfileId: input.llmProfileId,
          branchId: input.branchId,
          branchAction: input.branchAction,
          contextReset: input.contextReset,
        });
      },
      cancelCanonicalAgentTask: async taskId => {
        const repo = new TaskRepository(db);
        const task = repo.findById(taskId);
        if (!task || task.type !== 'agent') return false;
        if (task.status === 'completed' || task.status === 'failed' || task.status === 'stopped')
          return true;
        const taskService = new TaskService(repo);
        const stopped = await agentTaskExecutor.stop(taskId, 'Cancelled by user');
        taskService.stopTask(taskId, stopped.result);
        return true;
      },
    };
  }

  getSessionSync(): SessionSyncPort {
    return {
      broadcastSessionUpdated: (sessionId, db) => {
        const gatewayClient = getGatewayClient();
        if (!gatewayClient) return;

        const updatedSession = db
          .prepare(
            `
          SELECT s.id, s.name, s.updated_at as updatedAt, s.archived_at as archivedAt
          FROM sessions s
          WHERE s.id = ?
        `
          )
          .get(sessionId);

        if (updatedSession) {
          gatewayClient.commands.backendData.broadcastSessionEvent('updated', updatedSession);
        }
      },
    };
  }

  getMessageHandlerContext(
    handleRunStart: MessageHandlerContext['handleRunStart'],
    cancelRun: MessageHandlerContext['cancelRun']
  ): MessageHandlerContext {
    return {
      activeRuns: this.activeRuns,
      connectedClients: this.connectedClients,
      processMonitor: this.processMonitor,
      handleRunStart,
      cancelRun,
      broadcastPluginState: () => this.broadcastPluginState(),
      findProcessPidsByTaskCommand,
      notificationService: this.notificationsService,
      taskCoordination: this.getTaskCoordination(),
      providerRegistry,
      permissionBridge: this.permissionBridge,
      cancelWorkflowRun: this.cancelWorkflowRun,
      metaWorkflowService: this.metaWorkflowService,
      browserManager: this.browserManager,
      installBrowserEngine: this.installBrowserEngineFn,
      broadcastBrowserEngineStatus: msg => this.broadcastBrowserEngineStatus(msg),
      pauseActiveGoalForSession: (sessionId: string) => {
        const goalService = this.goalService;
        if (!goalService) return;
        const g = goalService.getActive(sessionId);
        if (g && g.status === 'active') {
          try {
            goalService.pause(g.id);
          } catch (err) {
            console.warn('[goal] pause-on-cancel failed', err);
          }
        }
      },
    };
  }

  getRunHandlerContext(): RunHandlerContext {
    const notificationSender = this.notificationSender;
    if (!notificationSender) {
      throw new Error('Notification sender is not initialized');
    }

    return {
      activeRuns: this.activeRuns,
      processMonitor: this.processMonitor,
      notificationService: notificationSender,
      notificationsService: this.notificationsService,
      serverPort: this.serverPort,
      broadcastHeartbeat: () => this.broadcastHeartbeat(),
      permissionBridge: this.permissionBridge,
      permissionWorkflowResolver: this.permissionWorkflowResolver,
      agentTaskExecutor: this.agentTaskExecutor,
      goalCoordinator: this.goalCoordinator,
      sessionSync: this.getSessionSync(),
      providerRegistry,
    };
  }

  buildClaudiaTaskSnapshot(): ClaudiaTaskSnapshotMessage | null {
    const db = this.database;
    if (!db) return null;
    const branchService = new ClaudiaBranchService(db);
    const canonicalRows = db
      .prepare(
        `
      SELECT id, session_id, status, title, description, result, metadata, created_at, updated_at
      FROM tasks
      WHERE type = 'agent'
        AND json_extract(metadata, '$.initiator') = 'claudia'
      ORDER BY created_at DESC
    `
      )
      .all() as Array<{
      id: string;
      session_id: string | null;
      status: string;
      title: string | null;
      description: string | null;
      result: string | null;
      metadata: string | null;
      created_at: number;
      updated_at: number;
    }>;
    const parseObject = (value: string | null): Record<string, unknown> => {
      if (!value) return {};
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
      } catch {
        return {};
      }
    };
    const stringValue = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() ? value : undefined;
    const canonicalTasks = canonicalRows.map(row => {
      const metadata = parseObject(row.metadata);
      const result = parseObject(row.result);
      const responseText = stringValue(result.text);
      const input = stringValue(metadata.input) ?? row.description ?? row.title ?? '';
      return {
        id: row.id,
        sessionId: row.session_id,
        branchId: stringValue(metadata.branchId) ?? null,
        branchAction: stringValue(metadata.branchAction) as BranchAction | undefined,
        contextReset: Boolean(metadata.contextReset),
        input,
        title: row.title ?? (input.trim().replace(/\s+/g, ' ').slice(0, 80) || 'Claudia Task'),
        status: (row.status === 'stopped' ? 'cancelled' : row.status) as ClaudiaTaskStatus,
        summary: responseText,
        error: stringValue(result.error),
        responseText,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });

    return {
      type: 'claudia_task_snapshot',
      tasks: canonicalTasks,
      activeBranches: branchService.listActiveBranches(),
    };
  }
}

/** Singleton server state — initialized once, used everywhere in server.ts */
export const serverState = new ServerState();
