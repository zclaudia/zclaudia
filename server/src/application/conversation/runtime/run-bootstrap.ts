import { newId } from '../../../utils/uuid.js';
import { parseMessageInput } from './message-input.js';
import type { ErrorMessage, ServerMessage } from '@zclaudia/shared/wire/messages';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import { resolveSkillSelection, skillRefKey } from '@zclaudia/shared/core/skills';
import type { McpToolRef, PluginToolRef, ToolName } from '@zclaudia/shared/core/tools';
import { getEligibleDiscoveredSkills, loadDiscoveredSkillContentSync, type DiscoveredSkill } from '../../../application/plugins/skill-tools.js';
import { createSkillRuntimeState, type ExternalToolRuntimeState } from '../../../infra/providers/pi-runtime/index.js';
import type { SkillRuntimeState } from '../../../infra/providers/pi-runtime/index.js';
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
import { resolveAgentForSession } from '../../../domains/agent-profiles/agent-resolver.js';
import { PhaseEmitter, isTerminalPhase } from './active-run-phase.js';
import { attachRunPhaseDomainEventEmitter } from './run-phase-domain-events.js';
import { appendMessagesToTree, buildUserMessage } from '../../../infra/providers/pi-runtime/session-tree/write-path.js';

export interface RunStartMessage extends Record<string, unknown> {
  type: 'run_start';
  clientRequestId: string;
  sessionId: string;
  input: string;
  llmProfileId?: string;
  /** User-selected mode id (matches one of `ProviderCapabilities.modes`). Typical
   *  values: `'default'` | `'plan'`. */
  mode?: string;
  permissionOverride?: Partial<import('@zclaudia/shared/interaction/permissions').UnifiedPermissionPolicy>;
  systemContext?: string;
  workingDirectory?: string;
  resend?: boolean;
  /** Arbitrary metadata to attach to the persisted user message (e.g. `{source: "goal-auto", goalId}`). */
  userMessageMetadata?: unknown;
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
  agent_profile_id: string | null;
  root_path: string | null;
}

export interface RunProviderEventState {
  sdkSessionId?: string;
  /** Sum of totalTokens across this run's turn-finished events; fed to the goal coordinator. */
  lastTurnTotalTokens?: number;
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
  agentProfile: AgentProfileConfig;
  broadcastSessionCatalogUpdate: () => void;
  connectedClients: Map<string, ConnectedClient>;
  cwd: string;
  enabledTools: ToolName[];
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

function buildExternalToolRuntimeState(profile: AgentProfileConfig): ExternalToolRuntimeState {
  const selection = profile.toolSelection;
  const pinnedExternalTools = (selection?.include ?? []).flatMap((ref): Array<McpToolRef | PluginToolRef> => {
    if (ref.source === 'mcp' || ref.source === 'plugin') return [ref];
    return [];
  });
  return {
    discoverableProviders: selection?.providers ?? [],
    pinnedExternalTools,
    loadedExternalTools: [...pinnedExternalTools],
  };
}

export function buildSkillRuntimeState(
  profile: AgentProfileConfig,
  eligibleSkills: DiscoveredSkill[] = getEligibleDiscoveredSkills(),
  loadContent: typeof loadDiscoveredSkillContentSync = loadDiscoveredSkillContentSync,
): SkillRuntimeState {
  const resolved = resolveSkillSelection(eligibleSkills, profile.skillSelection);
  const state = createSkillRuntimeState(resolved.discoverable, resolved.pinned);
  state.loadedSkills = [];
  for (const ref of resolved.pinned) {
    const content = loadContent(ref);
    if (!content) {
      console.warn(`[SkillRuntime] pinned skill unavailable: ${skillRefKey(ref)}`);
      continue;
    }
    state.loadedSkills.push(ref);
    state.loadedSkillContents[skillRefKey(ref)] = content;
  }
  return state;
}

export function initializeRunBootstrap(input: InitializeRunBootstrapInput): RunBootstrapResult | null {
  const { activeRuns, client, clients, db, message, runId, sessionSync, trace } = input;
  const connectedClients = clients ?? new Map<string, ConnectedClient>();

  // Load the session row + project root_path. LLM/agent resolution happens below
  // via AgentProfileRepository → LlmProfileRepository so the runtime can read all
  // resolved fields (model, systemPrompt, enabledTools, thinkingLevel) — not just llm_profile_id.
  const session = db.prepare(`
    SELECT s.id, s.project_id, s.name, s.sdk_session_id, s.type as session_type,
           s.working_directory, s.project_role, s.plan_status, s.task_id,
           s.agent_profile_id,
           p.root_path
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
      if (run.sessionId === message.sessionId && !isTerminalPhase(run.phase)) return id;
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

  // Resolve agent profile → LLM profile via the shared helper. session.agent_profile_id
  // is NOT NULL with FK RESTRICT (T2 schema), so the lookup should always succeed;
  // helper warns + falls back defensively at both agent and llm levels if integrity is
  // broken. `projectId` is intentionally NOT passed — once a session is created, its
  // agent_profile_id is canonical; project default only matters at session-create time.
  const { agent: agentProfile, llm: providerConfig } = resolveAgentForSession(
    db as unknown as import('better-sqlite3').Database,
    { explicitAgentId: session.agent_profile_id ?? undefined },
  );
  const llmProfileId = providerConfig?.id ?? null;
  const enabledTools = agentProfile.enabledTools as ToolName[];

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
  const requestedMode = message.mode && message.mode !== 'default' ? message.mode : undefined;
  const preservesSessionOnModeSwitch = providerPolicy?.modeSwitchSessionPolicy === 'preserve';
  const modeRequiresNewSession = Boolean(
    requestedMode
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
    assistantMessageId: newId(),
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
    pendingSteers: [],
    phase: 'running',
    phaseEmitter: new PhaseEmitter(),
    // Attach the resolved profiles so downstream consumers (compaction-service
    // on agent_end, future /compact handler) can run without re-querying the
    // DB. providerConfig may be undefined if resolution fell back — that's OK,
    // compaction simply won't trigger in that degraded mode.
    agentProfile,
    llmProfile: providerConfig ?? undefined,
    externalToolState: buildExternalToolRuntimeState(agentProfile),
    skillState: buildSkillRuntimeState(agentProfile),
  };
  activeRuns.set(runId, activeRun);
  attachRunPhaseDomainEventEmitter(activeRun);

  db.prepare('UPDATE sessions SET last_run_status = ?, updated_at = ? WHERE id = ?')
    .run('running', Date.now(), message.sessionId);

  let userMessageId: string | undefined;
  if (!message.resend) {
    userMessageId = newId();
    const userOffset = getNextOffset(db, message.sessionId);
    const parsedInput = parseMessageInput(message.input);
    // Route C: the messages-table row and the session-tree entry must commit
    // together — a partial write would leave the UI projection and the context
    // truth source disagreeing. (appendMessagesToTree's own transaction nests as
    // a savepoint.)
    // Build user message metadata: merge attachments (if any) with any caller-supplied
    // metadata (e.g. `{source: "goal-auto", goalId}` from GoalCoordinator).
    const userMsgMetadata: Record<string, unknown> = {};
    if (parsedInput.attachments.length > 0) userMsgMetadata.attachments = parsedInput.attachments;
    if (message.userMessageMetadata != null && typeof message.userMessageMetadata === 'object') {
      Object.assign(userMsgMetadata, message.userMessageMetadata as Record<string, unknown>);
    }
    const userMsgMetadataJson = Object.keys(userMsgMetadata).length > 0
      ? JSON.stringify(userMsgMetadata)
      : null;

    db.transaction(() => {
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, metadata, created_at, offset)
        VALUES (?, ?, 'user', ?, ?, ?, ?)
      `).run(
        userMessageId,
        message.sessionId,
        parsedInput.text,
        userMsgMetadataJson,
        Date.now(),
        userOffset,
      );
      const entryIds = appendMessagesToTree(db, message.sessionId, [buildUserMessage(parsedInput.text, parsedInput.attachments)]);
      db.prepare(`UPDATE messages SET tree_entry_id = ? WHERE id = ?`).run(entryIds[0], userMessageId);
    })();
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
    agentProfile,
    broadcastSessionCatalogUpdate,
    connectedClients,
    cwd,
    enabledTools,
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
