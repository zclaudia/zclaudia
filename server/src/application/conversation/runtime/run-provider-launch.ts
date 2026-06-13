import { pluginEvents } from '../../../infra/events/index.js';
import { negotiateProfile } from '../../../infra/providers/pcp-negotiator.js';
import type { ClaudeMessage, ProviderAdapter } from '../../../infra/providers/types.js';
import type { ResolvedImage } from './resolve-image-attachments.js';
import { buildRunContext } from './run-context.js';
import { upsertAssistantMessage } from './run-lifecycle.js';
import { PERIODIC_SAVE_INTERVAL_MS, type ActiveRun, type ConnectedClient } from '../transport/types.js';
import { sendMessage } from '../transport/broadcast.js';
import type { RunStartMessage, RunSessionRecord } from './run-bootstrap.js';
import type { TraceRecorder } from '../../../utils/provider-trace.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { ToolName } from '@zclaudia/shared/core/tools';
import type { PermissionDecision } from '../../../infra/providers/types.js';
import type { TaskExecutor } from '../../../domains/tasks/executors/types.js';
import { persistMcpInstructionsDeltaForSession } from './mcp-instructions-delta.js';
import { executePreparedDirectSkillInvocation, prepareDirectSkillInvocation } from '../../../infra/providers/pi-runtime/skills.js';
import { setPhase } from './active-run-phase.js';

interface LaunchProviderRunInput {
  activeRun: ActiveRun;
  adapter: ProviderAdapter;
  agentProfile: AgentProfileConfig;
  broadcastSessionCatalogUpdate: () => void;
  client: ConnectedClient;
  cwd: string;
  db: ActiveRun['db'];
  enabledTools: ToolName[];
  forcedPlanBySession: boolean;
  images: ResolvedImage[];
  message: RunStartMessage;
  modeValue: string;
  permissionCallback: (request: import('@zclaudia/shared/interaction/permissions').PermissionRequest) => Promise<PermissionDecision>;
  processedInput: string;
  providerConfig?: LlmProfileConfig;
  llmProfileId: string | null;
  providerType: string;
  runId: string;
  agentTaskExecutor?: TaskExecutor;
  sdkSessionId?: string;
  sendRunEvent: (event: import('@zclaudia/shared/wire/messages').ServerMessage) => void;
  serverPort: number | null;
  session: RunSessionRecord;
  sessionType: 'regular' | 'background' | 'agent';
  trace: TraceRecorder;
  userMessageId?: string;
  userHooks?: import('@zclaudia/shared/interaction/user-hooks').UserHookDefinition[];
}

export async function launchProviderRun(input: LaunchProviderRunInput): Promise<{
  providerRunner: AsyncIterable<ClaudeMessage>;
}> {
  const {
    activeRun,
    adapter,
    agentProfile,
    broadcastSessionCatalogUpdate,
    client,
    cwd,
    db,
    enabledTools,
    forcedPlanBySession,
    images,
    message,
    modeValue,
    permissionCallback,
    processedInput,
    providerConfig,
    llmProfileId,
    providerType,
    runId,
    agentTaskExecutor,
    sdkSessionId,
    sendRunEvent,
    serverPort,
    session,
    sessionType,
    trace,
    userMessageId,
    userHooks,
  } = input;

  if (adapter.manifest) {
    activeRun.effectiveProfile = negotiateProfile(adapter.manifest, {
      model: agentProfile.model,
      mode: modeValue,
      hasMcpBridge: !!serverPort,
      serverPort,
    });
    activeRun.effectiveProfile.sessionId = message.sessionId;
    trace.log('server_norm', 'profile_negotiated', {
      providerId: activeRun.effectiveProfile.providerId,
      capabilities: activeRun.effectiveProfile.capabilities
        .filter(c => c.enabled)
        .map(c => `${c.id}:${c.mode}/${c.reliability}`),
    }, 'PCP profile negotiated');
  }

  sendRunEvent({
    type: 'run_started',
    runId,
    sessionId: message.sessionId,
    clientRequestId: message.clientRequestId,
    userMessageId,
    assistantMessageId: activeRun.assistantMessageId,
    sessionType,
    effectiveProfile: activeRun.effectiveProfile,
  });
  broadcastSessionCatalogUpdate();

  pluginEvents.emit('run.started', {
    runId,
    sessionId: message.sessionId,
    input: message.input,
    llmProfileId,
    providerType: providerConfig?.providerType,
  }).catch((err: unknown) => {
    console.warn('[PluginEvents] Event emission failed:', err instanceof Error ? err.message : err);
  });

  if (sessionType === 'background') {
    sendRunEvent({
      type: 'background_task_update',
      sessionId: message.sessionId,
      status: 'running',
    } as import('@zclaudia/shared/wire/messages').BackgroundTaskUpdateMessage);
  }

  persistMcpInstructionsDeltaForSession(db as import('better-sqlite3').Database, message.sessionId);

  let effectiveInput = processedInput;
  const directSkill = await prepareDirectSkillInvocation(activeRun.skillState, processedInput, { agentProfile });
  if (directSkill.matched) {
    if (!directSkill.ok) {
      return completeRunLocally({
        activeRun,
        content: directSkill.message,
        message,
        runId,
        sendRunEvent,
      });
    }
    if (directSkill.mode === 'fork') {
      if (!activeRun.skillState) {
        return completeRunLocally({
          activeRun,
          content: 'Skill runtime state is unavailable for direct skill invocation.',
          message,
          runId,
          sendRunEvent,
        });
      }
      const forkResult = await executePreparedDirectSkillInvocation(activeRun.skillState, directSkill, {
        cwd,
        db: db as import('better-sqlite3').Database,
        enabledTools,
        llmProfileConfig: providerConfig,
        agentProfile,
        permissionCallback,
      });
      return completeRunLocally({
        activeRun,
        content: forkResult.ok ? forkResult.result : forkResult.message,
        message,
        runId,
        sendRunEvent,
      });
    }
    effectiveInput = directSkill.processedInput;
    trace.log('server_norm', 'direct_skill_invoked', {
      skillId: directSkill.ref.id,
      skillSource: directSkill.ref.source,
    }, directSkill.message);
  }

  const { runOptions } = await buildRunContext({
    adapter,
    agentProfile,
    cwd,
    db,
    enabledTools,
    forcedPlanBySession,
    message,
    modeValue,
    providerConfig,
    providerType,
    runId,
    agentTaskExecutor,
    sdkSessionId,
    serverPort,
    session,
    sessionType,
  });
  runOptions.externalToolState = activeRun.externalToolState;
  runOptions.skillState = activeRun.skillState;
  runOptions.images = images.length > 0 ? images : undefined;
  runOptions.userHooks = userHooks && userHooks.length > 0 ? userHooks : undefined;

  // Wire mid-run steering callbacks. The closure captures `activeRun` directly
  // (not via activeRuns map) so registration is robust even if the run is
  // removed from the map mid-flight; the mutations are idempotent on a stale
  // reference and cancelRun's clears still win deterministically.
  runOptions.onAgentReady = (handle) => {
    activeRun.steerHandle = handle;
  };
  runOptions.onSteerConsumed = () => {
    activeRun.pendingSteers = [];
  };

  console.log(`[Run Debug] session=${message.sessionId} sdk_session=${sdkSessionId || 'NEW'} provider=${providerType} mode=${modeValue} model=${agentProfile.model || 'default'} cwd=${cwd} baseUrl=${providerConfig?.baseUrl || 'default'}`);
  trace.setMeta({ provider: providerType, cwd });
  trace.log('server_norm', 'provider_runner_created', {
    providerType,
    sdkSessionId,
    modeValue,
    model: agentProfile.model,
    cwd,
  }, `provider runner ${providerType}`);

  const providerRunner = adapter.run(effectiveInput, runOptions, permissionCallback);

  activeRun.providerType = providerType;
  const runState = adapter.getRunState?.(runOptions) || {};
  Object.assign(activeRun, runState);

  activeRun.saveInterval = setInterval(() => {
    try {
      upsertAssistantMessage(activeRun);
    } catch (err) {
      console.error(`[Periodic Save] Failed for run ${runId}:`, err);
    }
  }, PERIODIC_SAVE_INTERVAL_MS);

  return { providerRunner };
}

function completeRunLocally(input: {
  activeRun: ActiveRun;
  content: string;
  message: RunStartMessage;
  runId: string;
  sendRunEvent: (event: import('@zclaudia/shared/wire/messages').ServerMessage) => void;
}): { providerRunner: AsyncIterable<ClaudeMessage> } {
  const { activeRun, content, message, runId, sendRunEvent } = input;
  activeRun.fullContent = content;
  activeRun.contentBlocks.push({ type: 'text', content });
  sendRunEvent({
    type: 'delta',
    runId,
    sessionId: message.sessionId,
    content,
  });
  upsertAssistantMessage(activeRun, { indexMetadata: true });
  sendRunEvent({
    type: 'run_completed',
    runId,
    sessionId: message.sessionId,
  });
  setPhase(activeRun, 'completed');
  return { providerRunner: emptyProviderStream() };
}

// eslint-disable-next-line require-yield -- intentional: an empty async iterable that yields nothing
async function* emptyProviderStream(): AsyncIterable<ClaudeMessage> {
  return;
}
