import { v4 as uuidv4 } from 'uuid';
import type { ErrorMessage, ServerMessage } from '@zclaudia/shared/wire/messages';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import { sendMessage, broadcastToOtherAuthenticatedClients } from '../transport/broadcast.js';
import type { ActiveRun, ConnectedClient } from '../transport/types.js';
import { getNextOffset } from './run-lifecycle.js';
import {
  loadProjectAllowedOutsideWorkspaceRoots,
  loadSessionRememberedDecisions,
} from '../agent/permission-evaluator.js';
import type { SessionSyncPort } from '../../../application/conversation/session-sync-port.js';
import { normalizeSessionWorkingDirectory } from '../../../utils/server-utils.js';
import { resolveProviderCwd } from '../../../utils/provider-cwd.js';
import { providerRegistry } from '../../../infra/providers/registry.js';
import type { initDatabase } from '../../../infra/storage/db.js';
import type { TraceRecorder } from '../../../utils/provider-trace.js';
import { LlmProfileRepository } from '../../../domains/llm-profiles/repository.js';

export interface RunStartMessage extends Record<string, unknown> {
  type: 'run_start';
  clientRequestId: string;
  sessionId: string;
  input: string;
  llmProfileId?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  mode?: string;
  model?: string;
  permissionOverride?: Partial<import('@zclaudia/shared/interaction/permissions').UnifiedPermissionPolicy>;
  systemContext?: string;
  workingDirectory?: string;
  resend?: boolean;
}

export interface RunSessionRecord {
  id: string;
  project_id: string;
  name: string | null;
  sdk_session_id: string | null;
  session_type: 'regular' | 'background' | 'agent' | null;
  working_directory: string | null;
  project_role: string | null;
  plan_status: string | null;
  task_id: string | null;
  root_path: string | null;
  llm_profile_id: string | null;
  system_prompt: string | null;
}

export interface RunProviderEventState {
  sdkSessionId?: string;
}

interface InitializeRunBootstrapInput {
  activeRuns: Map<string, ActiveRun>;
  client: ConnectedClient;
  clients?: Map<string, ConnectedClient>;
  db: ReturnType<typeof initDatabase>;
  message: RunStartMessage;
  runId: string;
  sessionSync?: SessionSyncPort;
  trace: TraceRecorder;
}

export interface RunBootstrapResult {
  activeRun: ActiveRun;
  broadcastSessionCatalogUpdate: () => void;
  connectedClients: Map<string, ConnectedClient>;
  cwd: string;
  markPendingResolutionResumed: () => void;
  persistSessionWorkingDirectory: (nextWorkingDirectory: string | null | undefined) => void;
  projectId: string;
  providerConfig?: LlmProfileConfig;
  providerEventState: RunProviderEventState;
  llmProfileId: string | null;
  requestedCwd: string;
  sendRunEvent: (event: ServerMessage) => void;
  session: RunSessionRecord;
  sessionType: 'regular' | 'background' | 'agent';
  userMessageId?: string;
}

export function initializeRunBootstrap(input: InitializeRunBootstrapInput): RunBootstrapResult | null {
  const { activeRuns, client, clients, db, message, runId, sessionSync, trace } = input;
  const connectedClients = clients ?? new Map<string, ConnectedClient>();

  const session = db.prepare(`
    SELECT s.id, s.project_id, s.name, s.sdk_session_id, s.type as session_type,
           s.working_directory, s.project_role, s.plan_status, s.task_id,
           p.root_path, COALESCE(s.llm_profile_id, p.llm_profile_id) as llm_profile_id, p.system_prompt
    FROM sessions s
    LEFT JOIN projects p ON s.project_id = p.id
    WHERE s.id = ?
  `).get(message.sessionId) as RunSessionRecord | undefined;

  if (!session) {
    trace.log('server_norm', 'run_start_rejected', { reason: 'SESSION_NOT_FOUND' }, 'session not found');
    sendMessage(client.ws, {
      type: 'error',
      code: 'SESSION_NOT_FOUND',
      message: 'Session not found',
    } as ErrorMessage);
    return null;
  }

  const existingRunId = (() => {
    for (const [id, run] of activeRuns.entries()) {
      if (run.sessionId === message.sessionId && !run.completed) return id;
    }
    return null;
  })();
  if (existingRunId) {
    trace.log('server_norm', 'run_start_rejected', { reason: 'SESSION_BUSY', existingRunId }, 'session busy');
    sendMessage(client.ws, {
      type: 'error',
      code: 'SESSION_BUSY',
      message: `Session is already running (runId: ${existingRunId})`,
    } as ErrorMessage);
    return null;
  }

  const llmProfileRepo = new LlmProfileRepository(db as unknown as import('better-sqlite3').Database);
  const explicitProfileId = message.llmProfileId || session.llm_profile_id;

  let providerConfig: LlmProfileConfig | undefined;
  if (explicitProfileId) {
    providerConfig = llmProfileRepo.findById(explicitProfileId) ?? undefined;
    if (!providerConfig) {
      console.warn(`[run-bootstrap] llm_profile_id ${explicitProfileId} not found, falling back to default`);
      providerConfig = llmProfileRepo.findDefault() ?? undefined;
    }
  } else {
    providerConfig = llmProfileRepo.findDefault() ?? undefined;
  }
  const llmProfileId = providerConfig?.id ?? null;

  if (providerConfig) {
    trace.setMeta({ provider: providerConfig.providerType });
  }

  const sessionType = (session.session_type || 'regular') as 'regular' | 'background' | 'agent';
  const projectId = session.project_id || message.sessionId;
  const providerTypeForSession = providerConfig?.providerType || 'zclaudia';
  const providerPolicy = providerRegistry.getPolicy(providerTypeForSession);

  // Some providers ignore a new non-default mode when resuming an existing
  // provider session. Keep the previous behavior by default, and let providers
  // that support `resume + mode` opt into preservation via their policy.
  const requestedMode = message.mode || message.permissionMode;
  const preservesSessionOnModeSwitch = providerPolicy?.modeSwitchSessionPolicy === 'preserve';
  const modeRequiresNewSession = Boolean(
    requestedMode
      && requestedMode !== 'default'
      && session.sdk_session_id
      && !preservesSessionOnModeSwitch
  );
  const effectiveSdkSessionId = modeRequiresNewSession ? undefined : (session.sdk_session_id || undefined);

  const requestedCwd = message.workingDirectory
    || session.working_directory
    || session.root_path
    || process.cwd();
  if (modeRequiresNewSession) {
    trace.log('server_norm', 'mode_switch_new_session', {
      requestedMode,
      previousSdkSession: session.sdk_session_id,
    }, `mode=${requestedMode} forces new SDK session`);
  }

  const cwd = resolveProviderCwd({
    sessionCwdPolicy: providerPolicy?.sessionCwdPolicy,
    sdkSessionId: effectiveSdkSessionId,
    requestedCwd,
    sessionRootPath: session.root_path,
    persistedWorkingDirectory: session.working_directory,
  });

  const activeRun: ActiveRun = {
    runId,
    clientId: client.id,
    client,
    pendingPermissions: new Map(),
    db,
    sessionId: message.sessionId,
    projectId,
    assistantMessageId: uuidv4(),
    fullContent: '',
    collectedToolCalls: [],
    contentBlocks: [],
    thinkingBlocks: [],
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    recentToolCalls: [],
    loopHeartbeatStreak: 0,
    pendingBackgroundTasks: 0,
    sessionType,
    workspaceRoot: cwd,
    rememberedDecisions: loadSessionRememberedDecisions(db, message.sessionId),
    allowedOutsideWorkspaceRoots: loadProjectAllowedOutsideWorkspaceRoots(db, projectId),
    aiInitiatedPlanMode: false,
    eventSeq: 0,
  };
  activeRuns.set(runId, activeRun);

  db.prepare('UPDATE sessions SET last_run_status = ?, updated_at = ? WHERE id = ?')
    .run('running', Date.now(), message.sessionId);

  let userMessageId: string | undefined;
  if (!message.resend) {
    userMessageId = uuidv4();
    const userOffset = getNextOffset(db, message.sessionId);
    db.prepare(`
      INSERT INTO messages (id, session_id, role, content, created_at, offset)
      VALUES (?, ?, 'user', ?, ?, ?)
    `).run(userMessageId, message.sessionId, message.input, Date.now(), userOffset);
  }

  // Wire broadcast: sends to ALL connected clients (originating + others).
  // Used by run-lifecycle, run-permissions, etc. via activeRun.broadcast.
  activeRun.broadcast = (msg: ServerMessage) => {
    sendMessage(client.ws, msg);
    if (connectedClients.size > 0) broadcastToOtherAuthenticatedClients(connectedClients, client.id, msg);
  };

  const sendRunEvent = (event: ServerMessage) => {
    if ('runId' in event) {
      activeRun.eventSeq += 1;
      (event as ServerMessage & { seq?: number }).seq = activeRun.eventSeq;
    }
    trace.log('server_norm', event.type, event);
    activeRun.broadcast!(event);
  };

  const providerEventState: RunProviderEventState = {
    sdkSessionId: effectiveSdkSessionId,
  };

  let persistedWorkingDirectory = normalizeSessionWorkingDirectory(session.working_directory, session.root_path);
  trace.setMeta({
    provider: providerConfig?.providerType,
    cwd: message.workingDirectory || persistedWorkingDirectory || session.root_path || undefined,
  });

  const persistSessionWorkingDirectory = (nextWorkingDirectory: string | null | undefined) => {
    const normalizedNext = normalizeSessionWorkingDirectory(nextWorkingDirectory, session.root_path);
    if (normalizedNext === persistedWorkingDirectory) return;

    const now = Date.now();
    db.prepare(`
      UPDATE sessions
      SET working_directory = ?, updated_at = ?
      WHERE id = ?
    `).run(normalizedNext, now, message.sessionId);

    persistedWorkingDirectory = normalizedNext;

    sessionSync?.broadcastSessionUpdated(message.sessionId, db);
  };

  const broadcastSessionCatalogUpdate = () => {
    sessionSync?.broadcastSessionUpdated(message.sessionId, db);
  };

  const markPendingResolutionResumed = () => {
    db.prepare('UPDATE sessions SET last_run_status = ?, updated_at = ? WHERE id = ?')
      .run('running', Date.now(), activeRun.sessionId);

    if (sessionType === 'background') {
      activeRun.broadcast!({
        type: 'background_task_update',
        sessionId: message.sessionId,
        status: 'running',
      } as import('@zclaudia/shared/wire/messages').BackgroundTaskUpdateMessage);
    }
  };

  return {
    activeRun,
    broadcastSessionCatalogUpdate,
    connectedClients,
    cwd,
    markPendingResolutionResumed,
    persistSessionWorkingDirectory,
    projectId,
    providerConfig,
    providerEventState,
    llmProfileId,
    requestedCwd,
    sendRunEvent,
    session,
    sessionType,
    userMessageId,
  };
}
