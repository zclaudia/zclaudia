import { normalizeLegacyRunInput } from '@zclaudia/shared/wire/messages';
import { createHash } from 'node:crypto';
import { newId } from '../../../utils/uuid.js';
import type {
  ClaudiaMessageMessage,
  ClaudiaTaskSubmitMessage,
  ClaudiaTaskContinueMessage,
  ClaudiaTaskCancelMessage,
  ClaudiaMessageFailedMessage,
  ClaudiaMessageDeltaMessage,
  ClaudiaMessageCompletedMessage,
  ClaudiaRequestAcceptedMessage,
  ClaudiaRequestRejectedMessage,
  ClaudiaTaskCreatedMessage,
  ErrorMessage,
} from '@zclaudia/shared/wire/messages';
import type { ConnectedClient, ActiveRun } from '../transport/types.js';
import type { initDatabase } from '../../../infra/storage/db.js';
import type { Database } from 'better-sqlite3';
import type { NotificationService } from '../../../domains/notification-feed/index.js';
import type { TaskCoordinationPort } from '../../../application/conversation/task-coordination-port.js';
import type { WebSocket } from 'ws';
import { sendMessage } from '../transport/broadcast.js';
import { NoAgentAvailableError } from '../../../domains/sessions/agent-resolver.js';
import { ProjectRepository } from '../../../domains/projects/repository.js';
import { SessionRepository } from '../../../domains/sessions/repository.js';
import {
  ClaudiaInlineSessionAllocationService,
  AgentProfileUnavailableError,
  ClaudiaSessionBusyError,
  ClaudiaThreadUnavailableError,
} from '../claudia-inline-session-allocation-service.js';
import { ClaudiaRequestRecordRepository } from '../../../domains/claudia/request-record-repository.js';
import { isTerminalPhase } from '../runtime/active-run-phase.js';

interface ClaudiaHandlerContext {
  activeRuns: Map<string, ActiveRun>;
  connectedClients: Map<string, ConnectedClient>;
  handleRunStart: (
    client: ConnectedClient,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- handleRunStart accepts various message shapes from different callers
    message: any,
    db: ReturnType<typeof initDatabase>,
    options?: Record<string, unknown>,
    clients?: Map<string, ConnectedClient>
  ) => Promise<void>;
  notificationService?: NotificationService;
  taskCoordination?: TaskCoordinationPort;
}

/** Non-terminal run occupying a session — includes awaiting_permission and
 *  awaiting_followup (design §忙碌时的行为: busy is decided by runs, not tasks). */
function findActiveRunId(activeRuns: Map<string, ActiveRun>, sessionId: string): string | null {
  for (const [runId, run] of activeRuns.entries()) {
    if (run.sessionId === sessionId && !isTerminalPhase(run.phase)) return runId;
  }
  return null;
}

function fingerprintRequest(message: ClaudiaMessageMessage, text: string): string {
  // Include every field that can change the execution target or context.
  return createHash('sha256')
    .update(
      JSON.stringify({
        projectId: message.projectId,
        activeBranchId: message.activeBranchId ?? null,
        forceNewBranch: message.forceNewBranch ?? false,
        agentProfileId: message.agentProfileId ?? null,
        llmProfileId: message.llmProfileId ?? null,
        contextProjectIds: [...new Set(message.contextProjectIds ?? [])],
        primaryContextProjectId: message.primaryContextProjectId ?? null,
        text,
      })
    )
    .digest('hex');
}

export async function handleClaudiaMessage(
  client: ConnectedClient,
  message: ClaudiaMessageMessage,
  db: ReturnType<typeof initDatabase>,
  clients: Map<string, ConnectedClient>,
  ctx: ClaudiaHandlerContext
): Promise<void> {
  const clientReqId = message.clientRequestId;
  const inlineInput = message.input?.trim();
  if (!inlineInput) return;

  const database = db as unknown as Database;
  const recordRepo = new ClaudiaRequestRecordRepository(database);

  const reject = (
    code: ClaudiaRequestRejectedMessage['code'],
    error: string,
    extra: Partial<ClaudiaRequestRejectedMessage> = {}
  ) => {
    sendMessage(client.ws, {
      type: 'claudia_request_rejected',
      clientRequestId: clientReqId,
      code,
      error,
      ...extra,
    } as ClaudiaRequestRejectedMessage);
  };

  if (!ctx.taskCoordination) {
    reject('RUN_START_FAILED', 'Task coordination not available');
    return;
  }

  if (inlineInput.length > 100_000) {
    reject('INPUT_TOO_LARGE', 'Input exceeds 100KB limit');
    return;
  }

  const inlineProjectId = message.projectId;
  const projectRepo = new ProjectRepository(database);
  if (!inlineProjectId || !projectRepo.exists(inlineProjectId)) {
    reject('PROJECT_NOT_FOUND', `Project not found: ${inlineProjectId}`, {
      projectId: inlineProjectId,
    });
    return;
  }

  // Validate context projects
  const contextProjectIds = Array.from(new Set((message.contextProjectIds || []).filter(Boolean)));
  const contextProjects = projectRepo.findContextSummariesByIds(contextProjectIds);
  if (contextProjects.length !== contextProjectIds.length) {
    const foundIds = new Set(contextProjects.map(project => project.id));
    const missingIds = contextProjectIds.filter(id => !foundIds.has(id));
    reject('CONTEXT_PROJECT_NOT_FOUND', `Context project(s) not found: ${missingIds.join(', ')}`, {
      projectId: inlineProjectId,
    });
    return;
  }

  // --- Transport dedup (design §去重与恢复, P0) ---
  const fingerprint = fingerprintRequest(message, inlineInput);
  const existingRecord = recordRepo.findById(clientReqId);
  if (existingRecord) {
    const sameRequest =
      existingRecord.payloadFingerprint === fingerprint &&
      existingRecord.projectId === inlineProjectId;
    if (!sameRequest) {
      reject('DUPLICATE_CONFLICT', 'Request id already used with a different payload', {
        projectId: inlineProjectId,
      });
      return;
    }
    if (existingRecord.outcome === 'accepted' && existingRecord.sessionId && existingRecord.runId) {
      // Replay of an accepted request — re-send the receipt; the client
      // reconciles actual run state from the thread snapshot.
      const boundSession = new SessionRepository(database).findById(existingRecord.sessionId);
      sendMessage(client.ws, {
        type: 'claudia_request_accepted',
        clientRequestId: clientReqId,
        projectId: existingRecord.projectId,
        branchId: existingRecord.branchId ?? '',
        sessionId: existingRecord.sessionId,
        runId: existingRecord.runId,
        branchAction: 'reused',
        agentProfileId: boundSession?.agentProfileId ?? '',
        agentProfileSource: 'session-bound',
        replay: true,
      } as ClaudiaRequestAcceptedMessage);
      return;
    }
    if (existingRecord.outcome === 'rejected') {
      reject(
        (existingRecord.errorCode as ClaudiaRequestRejectedMessage['code']) ?? 'RUN_START_FAILED',
        'Request was previously rejected',
        {
          projectId: inlineProjectId,
          sessionId: existingRecord.sessionId ?? undefined,
          branchId: existingRecord.branchId ?? undefined,
          runId: existingRecord.runId ?? undefined,
        }
      );
      return;
    }
    // 'uncertain' — registered but never confirmed started; never auto-rerun.
    reject(
      'RUN_START_FAILED',
      'Previous attempt with this request id did not start cleanly; use a new request or resume the session',
      { projectId: inlineProjectId }
    );
    return;
  }

  const displayInput = normalizeLegacyRunInput(inlineInput).text || 'Attached files';
  const inlineTitle = displayInput.replace(/\s+/g, ' ').slice(0, 80);
  const primaryContextProject =
    contextProjects.find(project => project.id === message.primaryContextProjectId) ??
    contextProjects[0] ??
    null;
  const hostProject = projectRepo.findContextSummariesByIds([inlineProjectId])[0];
  const sessionWorkingDirectory = hostProject?.rootPath || undefined;
  const contextSystemPrompt =
    contextProjects.length > 0
      ? [
          'Attached project context:',
          ...contextProjects.map((project, index) => {
            const primaryTag = primaryContextProject?.id === project.id ? ' [primary]' : '';
            const rootInfo = project.rootPath ? project.rootPath : 'no root path configured';
            return `${index + 1}. ${project.name} (${project.id})${primaryTag} — root: ${rootInfo}`;
          }),
          '',
          'These projects are reference context. Keep file and shell operations in the session workspace unless the user explicitly changes the execution target.',
        ].join('\n')
      : undefined;

  // Register the request BEFORE allocating so a crash between the two steps
  // leaves an 'uncertain' record (replayable as such) instead of a duplicate run.
  recordRepo.register({
    clientRequestId: clientReqId,
    callerScope: 'claudia_chat',
    projectId: inlineProjectId,
    branchId: null,
    sessionId: null,
    payloadFingerprint: fingerprint,
  });

  // --- Allocation + session admission (one serialized sync block) ---
  const branchService = ctx.taskCoordination;
  const freshSessionId = newId();
  let inlineAllocation;
  try {
    inlineAllocation = new ClaudiaInlineSessionAllocationService(database, branchService).allocate({
      hostProjectId: inlineProjectId,
      activeBranchId: message.activeBranchId,
      forceNew: message.forceNewBranch,
      title: inlineTitle,
      freshSessionId,
      input: displayInput,
      workingDirectory: sessionWorkingDirectory,
      explicitAgentId: message.agentProfileId,
      isSessionBusy: sessionId => findActiveRunId(ctx.activeRuns, sessionId),
    });
  } catch (err) {
    if (err instanceof ClaudiaSessionBusyError) {
      recordRepo.markRejected(clientReqId, 'SESSION_BUSY', {
        branchId: message.activeBranchId,
        sessionId: err.sessionId,
        runId: err.runId ?? undefined,
      });
      reject('SESSION_BUSY', `Session is busy; wait for the current run or start a new topic`, {
        projectId: inlineProjectId,
        sessionId: err.sessionId,
        runId: err.runId ?? undefined,
      });
      return;
    }
    if (err instanceof ClaudiaThreadUnavailableError) {
      recordRepo.markRejected(clientReqId, 'THREAD_NOT_FOUND');
      reject('THREAD_NOT_FOUND', err.message, {
        projectId: inlineProjectId,
        branchId: message.activeBranchId,
      });
      return;
    }
    if (err instanceof AgentProfileUnavailableError) {
      recordRepo.markRejected(clientReqId, 'AGENT_UNAVAILABLE');
      reject('AGENT_UNAVAILABLE', err.message, { projectId: inlineProjectId });
      return;
    }
    if (err instanceof NoAgentAvailableError) {
      recordRepo.markRejected(clientReqId, 'NO_AGENT_AVAILABLE');
      reject(
        'NO_AGENT_AVAILABLE',
        'No default agent profile available — create one in Settings first',
        {
          projectId: inlineProjectId,
        }
      );
      return;
    }
    recordRepo.markRejected(clientReqId, 'RUN_START_FAILED');
    throw err;
  }

  const { sessionId, branchId, branchAction, contextReset } = inlineAllocation;
  // Bind the resolved branch/session to the request record now that admission
  // passed; the run id lands when run_started arrives.
  recordRepo.bindTarget(clientReqId, branchId, sessionId);

  let completed = false;
  let fullContent = '';
  let boundRunId: string | undefined;

  // Build intercepting wrapper client. The accepted receipt is sent when the
  // run's `run_started` event confirms occupancy — with full run identity.
  const wrapperWs = {
    readyState: 1,
    send: (data: string) => {
      try {
        const evt = JSON.parse(data);
        // Run broadcasts also reach the virtual clients of other Claudia runs.
        // Never translate another session/run's events into this request.
        if (evt.sessionId && evt.sessionId !== sessionId) return;
        if (boundRunId && evt.runId && evt.runId !== boundRunId) return;
        if (completed) return;
        if (evt.type === 'run_started') {
          boundRunId = evt.runId;
          recordRepo.markAccepted(clientReqId, {
            branchId,
            sessionId: evt.sessionId ?? sessionId,
            runId: evt.runId,
          });
          sendMessage(client.ws, {
            type: 'claudia_request_accepted',
            clientRequestId: clientReqId,
            projectId: inlineProjectId,
            branchId,
            sessionId: evt.sessionId ?? sessionId,
            runId: evt.runId,
            branchAction,
            contextReset,
            userMessageId: evt.userMessageId,
            assistantMessageId: evt.assistantMessageId,
            agentProfileId: inlineAllocation.agentProfileId,
            agentProfileSource: inlineAllocation.agentProfileSource,
            workingDirectory:
              new SessionRepository(database).findById(sessionId)?.workingDirectory ??
              sessionWorkingDirectory,
          } as ClaudiaRequestAcceptedMessage);
        } else if (evt.type === 'delta') {
          const text = evt.content || '';
          fullContent += text;
          sendMessage(client.ws, {
            type: 'claudia_message_delta',
            clientRequestId: clientReqId,
            content: text,
            seq: evt.seq,
            sessionId: evt.sessionId ?? sessionId,
            runId: evt.runId,
          } as ClaudiaMessageDeltaMessage);
        } else if (evt.type === 'run_completed') {
          completed = true;
          sendMessage(client.ws, {
            type: 'claudia_message_completed',
            clientRequestId: clientReqId,
            responseText: fullContent,
            sessionId: evt.sessionId ?? sessionId,
            runId: evt.runId,
          } as ClaudiaMessageCompletedMessage);
          clients.delete(wrapperClientId);
        } else if (evt.type === 'run_failed') {
          completed = true;
          clients.delete(wrapperClientId);
          const errorMsg = evt.error || 'Task failed';
          sendMessage(client.ws, {
            type: 'claudia_message_failed',
            clientRequestId: clientReqId,
            error: errorMsg,
            sessionId: evt.sessionId ?? sessionId,
            runId: evt.runId,
          } as ClaudiaMessageFailedMessage);
        } else if (evt.type === 'error' && !completed) {
          // Run bootstrap rejected after our own admission passed (e.g. a race
          // with another client's run on the same session).
          completed = true;
          clients.delete(wrapperClientId);
          const code =
            evt.code === 'SESSION_BUSY' ? 'SESSION_BUSY' : (evt.code ?? 'RUN_START_FAILED');
          recordRepo.markRejected(clientReqId, code);
          reject(code, evt.message || 'Run failed to start', {
            projectId: inlineProjectId,
            branchId,
            sessionId: evt.sessionId ?? sessionId,
          });
        }
      } catch (error) {
        console.error('[Claudia] Failed to project run event:', error);
      }
    },
  };

  const wrapperClientId = `claudia-inline-${clientReqId}`;
  const wrapperClient = {
    id: wrapperClientId,
    ws: wrapperWs as unknown as WebSocket,
    isAlive: true,
    isLocal: true,
    authenticated: true,
  } as ConnectedClient;
  clients.set(wrapperClientId, wrapperClient);

  // Start the run
  ctx
    .handleRunStart(
      wrapperClient,
      {
        type: 'run_start',
        clientRequestId: clientReqId,
        sessionId,
        input: inlineInput,
        llmProfileId: message.llmProfileId,
        systemContext: contextSystemPrompt,
        _contextTemplate: 'agent',
      },
      db,
      {},
      clients
    )
    .catch(err => {
      completed = true;
      clients.delete(wrapperClientId);
      recordRepo.markRejected(clientReqId, 'RUN_START_FAILED');
      reject(
        'RUN_START_FAILED',
        err instanceof Error ? err.message : 'Failed to start inline run',
        {
          projectId: inlineProjectId,
          branchId,
          sessionId,
        }
      );
    });
}

export async function handleClaudiaTaskSubmit(
  client: ConnectedClient,
  message: ClaudiaTaskSubmitMessage,
  db: ReturnType<typeof initDatabase>,
  taskCoordination: TaskCoordinationPort
): Promise<void> {
  const taskInput = message.input?.trim();
  if (!taskInput) return;

  if (taskInput.length > 100_000) {
    sendMessage(client.ws, {
      type: 'error',
      code: 'INPUT_TOO_LARGE',
      message: 'Task input exceeds 100KB limit',
    } as ErrorMessage);
    return;
  }

  const projectRepo = new ProjectRepository(db as unknown as Database);
  if (message.projectId && !projectRepo.exists(message.projectId)) {
    sendMessage(client.ws, {
      type: 'error',
      code: 'PROJECT_NOT_FOUND',
      message: `Project not found: ${message.projectId}`,
    } as ErrorMessage);
    return;
  }

  const title = taskInput.replace(/\s+/g, ' ').slice(0, 80);
  try {
    const submitBranchService = taskCoordination;
    const submitSessionId = newId();
    const submitAllocation = submitBranchService.allocateBranch({
      hostProjectId: message.projectId,
      activeBranchId: message.activeBranchId,
      forceNew: message.forceNewBranch,
      title,
      sessionId: submitSessionId,
    });
    if (submitAllocation.action !== 'forked') {
      submitBranchService.setActiveBranchId(message.projectId, submitAllocation.branchId);
    }

    const submitted = await taskCoordination.submitCanonicalAgentTask({
      input: taskInput,
      title,
      projectId: message.projectId,
      llmProfileId: message.llmProfileId,
      branchId: submitAllocation.branchId,
      branchAction: submitAllocation.action,
      contextReset: submitAllocation.contextReset,
    });
    submitBranchService.updateBranchTask(
      submitAllocation.branchId,
      submitted.taskId,
      submitted.sessionId
    );

    sendMessage(client.ws, {
      type: 'claudia_task_created',
      clientRequestId: message.clientRequestId,
      taskId: submitted.taskId,
      projectId: message.projectId,
      sessionId: submitted.sessionId,
      branchId: submitAllocation.branchId,
      branchAction: submitAllocation.action,
      title,
      status: 'queued',
    } as ClaudiaTaskCreatedMessage);
  } catch (err) {
    sendMessage(client.ws, {
      type: 'error',
      code: 'TASK_SPAWN_FAILED',
      message: err instanceof Error ? err.message : 'Failed to spawn task',
    } as ErrorMessage);
  }
}

export async function handleClaudiaTaskContinue(
  client: ConnectedClient,
  message: ClaudiaTaskContinueMessage,
  db: ReturnType<typeof initDatabase>,
  taskCoordination: TaskCoordinationPort
): Promise<void> {
  const continueInput = message.input?.trim();
  if (!continueInput) return;

  const parentTask = taskCoordination.getCanonicalAgentTask(message.taskId);
  if (!parentTask) {
    sendMessage(client.ws, {
      type: 'error',
      code: 'TASK_NOT_FOUND',
      message: `Task not found: ${message.taskId}`,
    } as ErrorMessage);
    return;
  }

  const title = continueInput.replace(/\s+/g, ' ').slice(0, 80);
  try {
    const continueBranchService = taskCoordination;
    const continueSessionId = newId();
    const continueAllocation = continueBranchService.allocateForContinue({
      taskBranchId: parentTask.branchId,
      hostProjectId: parentTask.projectId ?? '',
      title,
      sessionId: continueSessionId,
    });
    if (continueAllocation.action !== 'forked' && parentTask.projectId) {
      continueBranchService.setActiveBranchId(parentTask.projectId, continueAllocation.branchId);
    }

    const submitted = await taskCoordination.continueCanonicalAgentTask({
      parentTaskId: message.taskId,
      input: continueInput,
      title,
      projectId: parentTask.projectId ?? '',
      llmProfileId: parentTask.llmProfileId,
      branchId: continueAllocation.branchId,
      branchAction: continueAllocation.action,
      contextReset: continueAllocation.contextReset,
    });
    continueBranchService.updateBranchTask(
      continueAllocation.branchId,
      submitted.taskId,
      submitted.sessionId
    );

    sendMessage(client.ws, {
      type: 'claudia_task_created',
      clientRequestId: message.clientRequestId,
      taskId: submitted.taskId,
      projectId: parentTask.projectId ?? '',
      sessionId: submitted.sessionId,
      branchId: continueAllocation.branchId,
      branchAction: continueAllocation.action,
      title,
      status: 'queued',
      contextReset: continueAllocation.contextReset,
    } as ClaudiaTaskCreatedMessage);
  } catch (err) {
    sendMessage(client.ws, {
      type: 'error',
      code: 'TASK_CONTINUE_FAILED',
      message: err instanceof Error ? err.message : 'Failed to continue task',
    } as ErrorMessage);
  }
}

export async function handleClaudiaTaskCancel(
  client: ConnectedClient,
  message: ClaudiaTaskCancelMessage,
  taskCoordination: TaskCoordinationPort
): Promise<void> {
  const task = taskCoordination.getCanonicalAgentTask(message.taskId);
  if (!task) {
    sendMessage(client.ws, {
      type: 'error',
      code: 'TASK_NOT_FOUND',
      message: `Task not found: ${message.taskId}`,
    } as ErrorMessage);
    return;
  }

  try {
    await taskCoordination.cancelCanonicalAgentTask(message.taskId);
  } catch (err) {
    sendMessage(client.ws, {
      type: 'error',
      code: 'TASK_CANCEL_FAILED',
      message: err instanceof Error ? err.message : 'Failed to cancel task',
    } as ErrorMessage);
  }
}
