import { pluginEvents } from '../../../infra/events/index.js';
import { negotiateProfile } from '../../../infra/providers/pcp-negotiator.js';
import type { ClaudeMessage, ProviderAdapter } from '../../../infra/providers/types.js';
import { buildRunContext } from './run-context.js';
import { upsertAssistantMessage } from './run-lifecycle.js';
import { PERIODIC_SAVE_INTERVAL_MS, type ActiveRun, type ConnectedClient } from '../transport/types.js';
import { sendMessage } from '../transport/broadcast.js';
import type { RunStartMessage, RunSessionRecord } from './run-bootstrap.js';
import type { TraceRecorder } from '../../../utils/provider-trace.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { PermissionDecision } from '../../../infra/providers/types.js';

interface LaunchProviderRunInput {
  activeRun: ActiveRun;
  adapter: ProviderAdapter;
  broadcastSessionCatalogUpdate: () => void;
  client: ConnectedClient;
  cwd: string;
  db: ActiveRun['db'];
  forcedPlanBySession: boolean;
  message: RunStartMessage;
  modeValue: string;
  permissionCallback: (request: import('@zclaudia/shared/interaction/permissions').PermissionRequest) => Promise<PermissionDecision>;
  processedInput: string;
  providerConfig?: LlmProfileConfig;
  llmProfileId: string | null;
  providerType: string;
  runId: string;
  sdkSessionId?: string;
  sendRunEvent: (event: import('@zclaudia/shared/wire/messages').ServerMessage) => void;
  serverPort: number | null;
  session: RunSessionRecord;
  sessionType: 'regular' | 'background' | 'agent';
  trace: TraceRecorder;
  userMessageId?: string;
}

export async function launchProviderRun(input: LaunchProviderRunInput): Promise<{
  providerRunner: AsyncIterable<ClaudeMessage>;
}> {
  const {
    activeRun,
    adapter,
    broadcastSessionCatalogUpdate,
    client,
    cwd,
    db,
    forcedPlanBySession,
    message,
    modeValue,
    permissionCallback,
    processedInput,
    providerConfig,
    llmProfileId,
    providerType,
    runId,
    sdkSessionId,
    sendRunEvent,
    serverPort,
    session,
    sessionType,
    trace,
    userMessageId,
  } = input;

  if (adapter.manifest) {
    activeRun.effectiveProfile = negotiateProfile(adapter.manifest, {
      model: message.model,
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

  const { runOptions } = await buildRunContext({
    adapter,
    cwd,
    db,
    forcedPlanBySession,
    message,
    modeValue,
    providerConfig,
    providerType,
    sdkSessionId,
    serverPort,
    session,
    sessionType,
  });

  console.log(`[Run Debug] session=${message.sessionId} sdk_session=${sdkSessionId || 'NEW'} provider=${providerType} mode=${modeValue} model=${message.model || 'default'} cwd=${cwd} baseUrl=${providerConfig?.baseUrl || 'default'}`);
  trace.setMeta({ provider: providerType, cwd });
  trace.log('server_norm', 'provider_runner_created', {
    providerType,
    sdkSessionId,
    modeValue,
    model: message.model,
    cwd,
  }, `provider runner ${providerType}`);

  const providerRunner = adapter.run(processedInput, runOptions, permissionCallback);

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
