import { negotiateProfile } from '../../../infra/providers/pcp-negotiator.js';
import type { ProviderAdapter, ProviderRuntimeEvent } from '../../../infra/providers/types.js';
import type Database from 'better-sqlite3';
import type { PermissionRequest } from '@zclaudia/shared/interaction/permissions';
import type { UserHookDefinition } from '@zclaudia/shared/interaction/user-hooks';
import type { BackgroundTaskUpdateMessage, ServerMessage } from '@zclaudia/shared/wire/messages';
import type { ResolvedImage } from './resolve-image-attachments.js';
import { buildRunContext } from './run-context.js';
import { persistAssistantTerminalSnapshot } from './run-terminal-snapshot.js';
import { upsertAssistantMessage } from './run-lifecycle.js';
import {
  PERIODIC_SAVE_INTERVAL_MS,
  type ActiveRun,
  type ConnectedClient,
} from '../transport/types.js';
import type { RunStartMessage, RunSessionRecord } from './run-bootstrap.js';
import type { TraceRecorder } from '../../../utils/provider-trace.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { ToolName } from '@zclaudia/shared/core/tools';
import type { PermissionDecision } from '../../../infra/providers/types.js';
import type { TaskExecutor } from '../../../domains/tasks/executors/types.js';
import { persistMcpInstructionsDeltaForSession } from './mcp-instructions-delta.js';
import {
  executePreparedDirectSkillInvocation,
  prepareDirectSkillInvocation,
} from '../../../infra/providers/pi-runtime/skills.js';
import { setPhase } from './active-run-phase.js';
import { maybeCompact, waitForPendingCompaction } from '../compaction/compaction-service.js';
import { compactionDomainEventFor } from './compaction-events.js';
import { createSkillActivationObserver } from './skill-activation-observer.js';
import { createRunDomainEvent, type RunDomainEvent } from './run-domain-events.js';
import {
  runDomainEventListeners,
  type RunDomainEventListenerRegistry,
} from './run-domain-event-listeners.js';
import { projectRunDomainEventToWireMessages } from './wire-projector.js';
import { registerPluginDomainEventListener } from './plugin-domain-event-listener.js';
import { resolveMultimodalFallbackForRun } from './multimodal-fallback.js';

registerPluginDomainEventListener();

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
  permissionCallback: (request: PermissionRequest) => Promise<PermissionDecision>;
  processedInput: string;
  providerConfig?: LlmProfileConfig;
  llmProfileId: string | null;
  providerType: string;
  runId: string;
  agentTaskExecutor?: TaskExecutor;
  sdkSessionId?: string;
  sendRunEvent: (event: ServerMessage) => void;
  listeners?: RunDomainEventListenerRegistry;
  serverPort: number | null;
  session: RunSessionRecord;
  sessionType: 'regular' | 'background' | 'agent';
  trace: TraceRecorder;
  userMessageId?: string;
  userHooks?: UserHookDefinition[];
}

export async function launchProviderRun(input: LaunchProviderRunInput): Promise<{
  providerRunner: AsyncIterable<ProviderRuntimeEvent>;
}> {
  const {
    activeRun,
    adapter,
    agentProfile,
    broadcastSessionCatalogUpdate,
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
    providerType,
    runId,
    agentTaskExecutor,
    sdkSessionId,
    sendRunEvent,
    listeners,
    serverPort,
    session,
    sessionType,
    trace,
    userMessageId,
    userHooks,
  } = input;

  const baseMultimodalFallback = {
    applied: false,
    agentProfile,
    llmProfile: providerConfig,
    llmProfileId: input.llmProfileId ?? providerConfig?.id ?? agentProfile.llmProfileId,
    providerType,
  };
  const multimodalFallback =
    providerType === 'zclaudia'
      ? resolveMultimodalFallbackForRun({
          db: db as Database.Database,
          agentProfile,
          llmProfile: providerConfig,
          images,
        })
      : baseMultimodalFallback;
  const effectiveAgentProfile = multimodalFallback.agentProfile;
  const effectiveProviderConfig = multimodalFallback.llmProfile;
  const effectiveLlmProfileId = multimodalFallback.llmProfileId;
  const effectiveProviderType = providerType;
  if (multimodalFallback.applied) {
    activeRun.agentProfile = effectiveAgentProfile;
    activeRun.llmProfile = effectiveProviderConfig;
    activeRun.providerType = effectiveProviderType;
    trace.log(
      'server_norm',
      'multimodal_fallback_applied',
      {
        llmProfileId: effectiveLlmProfileId,
        providerType: effectiveProviderType,
        model: effectiveAgentProfile.model,
      },
      `multimodal fallback model=${effectiveAgentProfile.model}`
    );
  }

  if (adapter.manifest) {
    activeRun.effectiveProfile = negotiateProfile(adapter.manifest, {
      model: effectiveAgentProfile.model,
      mode: modeValue,
      hasMcpBridge: !!serverPort,
      serverPort,
    });
    activeRun.effectiveProfile.sessionId = message.sessionId;
    trace.log(
      'server_norm',
      'profile_negotiated',
      {
        providerId: activeRun.effectiveProfile.providerId,
        capabilities: activeRun.effectiveProfile.capabilities
          .filter(c => c.enabled)
          .map(c => `${c.id}:${c.mode}/${c.reliability}`),
      },
      'PCP profile negotiated'
    );
  }

  dispatchRunStartedDomainEvent({
    activeRun,
    input: message.input,
    listeners,
    llmProfileId: effectiveLlmProfileId,
    providerType: effectiveProviderType,
    runId,
    sendRunEvent,
    sessionId: message.sessionId,
    clientRequestId: message.clientRequestId,
    userMessageId,
    sessionType,
  });
  broadcastSessionCatalogUpdate();

  if (sessionType === 'background') {
    sendRunEvent({
      type: 'background_task_update',
      sessionId: message.sessionId,
      status: 'running',
    } as BackgroundTaskUpdateMessage);
  }

  persistMcpInstructionsDeltaForSession(db as Database.Database, message.sessionId);

  // A previous turn may have published its terminal snapshot and continued
  // auto-compaction in the background. Never let the next run read or mutate
  // the same session tree until that compaction has finished.
  await waitForPendingCompaction(message.sessionId);

  let effectiveInput = processedInput;
  const directSkill = await prepareDirectSkillInvocation(activeRun.skillState, processedInput, {
    agentProfile: effectiveAgentProfile,
  });
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
      const forkResult = await executePreparedDirectSkillInvocation(
        activeRun.skillState,
        directSkill,
        {
          cwd,
          db: db as Database.Database,
          enabledTools,
          llmProfileConfig: effectiveProviderConfig,
          agentProfile: effectiveAgentProfile,
          permissionCallback,
        }
      );
      return completeRunLocally({
        activeRun,
        content: forkResult.ok ? forkResult.result : forkResult.message,
        message,
        runId,
        sendRunEvent,
      });
    }
    effectiveInput = directSkill.processedInput;
    trace.log(
      'server_norm',
      'direct_skill_invoked',
      {
        skillId: directSkill.ref.id,
        skillSource: directSkill.ref.source,
      },
      directSkill.message
    );
  }

  const { runOptions } = await buildRunContext({
    adapter,
    agentProfile: effectiveAgentProfile,
    cwd,
    db,
    enabledTools,
    forcedPlanBySession,
    message,
    modeValue,
    providerConfig: effectiveProviderConfig,
    providerType: effectiveProviderType,
    runId,
    agentTaskExecutor,
    sdkSessionId,
    serverPort,
    session,
    sessionType,
  });
  runOptions.externalToolState = activeRun.externalToolState;
  runOptions.skillState = activeRun.skillState;
  runOptions.abortController = activeRun.abortController;
  runOptions.images = images.length > 0 ? images : undefined;
  runOptions.userHooks = userHooks && userHooks.length > 0 ? userHooks : undefined;
  runOptions.toolExecutionObserver = createSkillActivationObserver();

  // Wire mid-run steering callbacks. The closure captures `activeRun` directly
  // (not via activeRuns map) so registration is robust even if the run is
  // removed from the map mid-flight; the mutations are idempotent on a stale
  // reference and cancelRun's clears still win deterministically.
  runOptions.onAgentReady = handle => {
    activeRun.steerHandle = handle;
  };
  runOptions.onSteerConsumed = () => {
    activeRun.pendingSteers = [];
  };

  console.log(
    `[Run Debug] session=${message.sessionId} sdk_session=${sdkSessionId || 'NEW'} provider=${effectiveProviderType} mode=${modeValue} model=${effectiveAgentProfile.model || 'default'} cwd=${cwd} baseUrl=${effectiveProviderConfig?.baseUrl || 'default'}`
  );
  trace.setMeta({ provider: effectiveProviderType, cwd });
  trace.log(
    'server_norm',
    'provider_runner_created',
    {
      providerType: effectiveProviderType,
      sdkSessionId,
      modeValue,
      model: effectiveAgentProfile.model,
      cwd,
    },
    `provider runner ${effectiveProviderType}`
  );

  // Pre-flight compaction. History is rebuilt from the DB inside adapter.run, so
  // if the stored history already exceeds the CURRENT model's threshold — e.g.
  // the session was switched from a large-window model to a smaller one, or
  // reopened after growing under a bigger window — we must compact BEFORE the
  // first request. The post-turn maybeCompact only runs at agent_end and can't
  // preempt an overflow that the very first request would trigger. Non-fatal: on
  // any failure the request still goes out and handleRunException's
  // overflow-recovery retry remains the net.
  if (effectiveProviderType === 'zclaudia' && effectiveProviderConfig) {
    try {
      const preflight = await maybeCompact({
        db: db as Database.Database,
        sessionId: message.sessionId,
        agentProfile: effectiveAgentProfile,
        llmProfile: effectiveProviderConfig,
        source: 'preflight',
        signal: activeRun.abortController?.signal,
      });
      if (preflight.outcome === 'compacted') {
        console.log(
          `[Compaction] preflight session=${message.sessionId} id=${preflight.compactionId} tokens=${preflight.tokensBefore}`
        );
        sendRunEvent({
          type: 'delta',
          runId,
          sessionId: message.sessionId,
          content: '⚠️ Context limit reached — compacted the conversation before starting…',
        });
        const event = compactionDomainEventFor({
          outcome: preflight,
          providerType: activeRun.providerType,
          runId,
          seq: (activeRun.eventSeq ?? 0) + 1,
          sessionId: message.sessionId,
        });
        if (event)
          emitRunLaunchDomainEvent({
            event,
            listeners,
            sendRunEvent,
          });
      }
    } catch (err) {
      console.warn(
        `[Compaction] preflight failed (non-fatal) session=${message.sessionId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  const providerRunner = adapter.run(effectiveInput, runOptions, permissionCallback);

  activeRun.providerType = effectiveProviderType;
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

function dispatchRunStartedDomainEvent(input: {
  activeRun: ActiveRun;
  clientRequestId?: string;
  input: string;
  listeners?: RunDomainEventListenerRegistry;
  llmProfileId: string | null;
  providerType?: string;
  runId: string;
  sendRunEvent: (event: ServerMessage) => void;
  sessionId: string;
  sessionType: 'regular' | 'background' | 'agent';
  userMessageId?: string;
}): void {
  const event = createRunDomainEvent({
    type: 'run.started',
    runId: input.runId,
    sessionId: input.sessionId,
    providerType: input.activeRun.providerType,
    seq: (input.activeRun.eventSeq ?? 0) + 1,
    source: 'runtime',
    payload: {
      clientRequestId: input.clientRequestId,
      assistantMessageId: input.activeRun.assistantMessageId,
      userMessageId: input.userMessageId,
      sessionType: input.sessionType,
      effectiveProfile: input.activeRun.effectiveProfile,
      input: input.input,
      llmProfileId: input.llmProfileId,
      providerType: input.providerType,
    },
  });

  emitRunLaunchDomainEvent({
    event,
    listeners: input.listeners,
    sendRunEvent: input.sendRunEvent,
  });
}

function emitRunLaunchDomainEvent(input: {
  event: RunDomainEvent;
  listeners?: RunDomainEventListenerRegistry;
  sendRunEvent: (event: ServerMessage) => void;
}): void {
  for (const wireEvent of projectRunDomainEventToWireMessages(input.event)) {
    input.sendRunEvent(stripProjectedSeq(wireEvent));
  }
  (input.listeners ?? runDomainEventListeners).emit(input.event);
}

function stripProjectedSeq(event: ServerMessage): ServerMessage {
  const eventForSend = { ...event };
  if ('seq' in eventForSend) {
    delete (eventForSend as { seq?: number }).seq;
  }
  return eventForSend;
}

function completeRunLocally(input: {
  activeRun: ActiveRun;
  content: string;
  message: RunStartMessage;
  runId: string;
  sendRunEvent: (event: ServerMessage) => void;
}): { providerRunner: AsyncIterable<ProviderRuntimeEvent> } {
  const { activeRun, content, message, runId, sendRunEvent } = input;
  activeRun.fullContent = content;
  activeRun.contentBlocks.push({ type: 'text', content });
  sendRunEvent({
    type: 'delta',
    runId,
    sessionId: message.sessionId,
    content,
  });
  setPhase(activeRun, 'finalizing');
  const terminalSnapshot = persistAssistantTerminalSnapshot(activeRun, { indexMetadata: true });
  sendRunEvent({
    type: 'run_completed',
    runId,
    sessionId: message.sessionId,
    ...terminalSnapshot,
  });
  setPhase(activeRun, 'completed');
  return { providerRunner: emptyProviderStream() };
}

// eslint-disable-next-line require-yield -- intentional: an empty async iterable that yields nothing
async function* emptyProviderStream(): AsyncIterable<ProviderRuntimeEvent> {
  return;
}
