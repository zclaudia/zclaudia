import type { ContentBlock, ToolEffect } from '@zclaudia/shared/core/message';
import type { UsageInfo } from '@zclaudia/shared/core/message';
import type { PCPEffectiveProfile } from '@zclaudia/shared/core/pcp';
import type { ToolSemantic } from '@zclaudia/shared/wire/messages/run';
import type { RunPhase } from './active-run-phase.js';
import { newId } from '../../../utils/uuid.js';

export const RUN_DOMAIN_EVENT_TYPES = [
  'run.started',
  'run.providerTurnFinished',
  'run.retryScheduled',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.finalized',
  'assistant.textDelta',
  'assistant.thinkingDelta',
  'assistant.thinkingFinalized',
  'assistant.outputFallbackApplied',
  'assistant.truncationSuspected',
  'tool.started',
  'tool.activity',
  'tool.finished',
  'tool.failed',
  'tool.effectDetected',
  'interaction.todoUpdated',
  'interaction.todoAutoCompleted',
  'interaction.promptRequested',
  'interaction.resolved',
  'mode.changed',
  'mode.aiInitiatedPlanEntered',
  'mode.aiInitiatedPlanExited',
  'backgroundTask.started',
  'backgroundTask.updated',
  'backgroundTask.finished',
  'backgroundTask.pidResolved',
  'backgroundFollowup.started',
  'backgroundFollowup.finished',
  'compaction.requested',
  'compaction.completed',
  'compaction.failed',
  'compaction.skipped',
  'permission.requested',
  'permission.resolved',
  'permission.autoResolved',
  'run.phaseChanged',
] as const;

export type RunDomainEventType = (typeof RUN_DOMAIN_EVENT_TYPES)[number];

export const PUBLIC_RUN_DOMAIN_EVENT_TYPES = [
  'run.started',
  'run.completed',
  'run.failed',
  'tool.started',
  'tool.finished',
  'mode.changed',
  'backgroundTask.started',
  'backgroundTask.finished',
  'backgroundFollowup.started',
  'backgroundFollowup.finished',
  'compaction.completed',
  'compaction.failed',
  'interaction.todoUpdated',
  'interaction.promptRequested',
  'interaction.resolved',
  'permission.requested',
  'permission.resolved',
  'permission.autoResolved',
  'run.phaseChanged',
] as const satisfies readonly RunDomainEventType[];

export type PublicRunDomainEventType = (typeof PUBLIC_RUN_DOMAIN_EVENT_TYPES)[number];

const PUBLIC_RUN_DOMAIN_EVENT_TYPE_SET = new Set<RunDomainEventType>(PUBLIC_RUN_DOMAIN_EVENT_TYPES);

export function isPublicRunDomainEventType(
  type: RunDomainEventType
): type is PublicRunDomainEventType {
  return PUBLIC_RUN_DOMAIN_EVENT_TYPE_SET.has(type);
}

export type RunDomainEventSource = 'provider' | 'runtime' | 'user' | 'system';

export interface RunDomainEventCause {
  providerEventType?: string;
  commandId?: string;
  toolUseId?: string;
  taskId?: string;
}

export interface RunDomainEventEnvelope<TType extends RunDomainEventType, TPayload> {
  eventId: string;
  type: TType;
  version: 1;
  occurredAt: number;
  runId: string;
  sessionId: string;
  providerType?: string;
  seq: number;
  source: RunDomainEventSource;
  cause?: RunDomainEventCause;
  payload: TPayload;
}

export type RunDomainEvent<TType extends RunDomainEventType = RunDomainEventType> =
  TType extends keyof RunDomainEventPayloadMap
    ? RunDomainEventEnvelope<TType, RunDomainEventPayloadMap[TType]>
    : never;

export interface RunDomainEventPayloadMap {
  'run.started': {
    clientRequestId?: string;
    assistantMessageId?: string;
    userMessageId?: string;
    sessionType?: 'regular' | 'background' | 'agent';
    input?: string;
    llmProfileId?: string | null;
    providerType?: string;
    effectiveProfile?: PCPEffectiveProfile;
  };
  'run.providerTurnFinished': {
    content?: string;
    usage?: UsageInfo;
  };
  'run.retryScheduled': {
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    status?: number;
  };
  'run.completed': {
    usage?: UsageInfo;
    assistantMessageId: string;
    messageVersion: number;
    /** Authoritative final assistant text/blocks so live clients can repair a
     *  delta-accumulated message that lost a tail frame in transit. */
    content?: string;
    contentBlocks?: ContentBlock[];
  };
  'run.failed': {
    error: string;
    errorCode?: string;
    assistantMessageId?: string;
    messageVersion?: number;
    content?: string;
    contentBlocks?: ContentBlock[];
  };
  'run.cancelled': {
    reason?: string;
    restoreDraft?: string;
  };
  'run.finalized': {
    phase: RunPhase;
    contentChars: number;
    collectedToolCalls: number;
  };
  'assistant.textDelta': {
    content: string;
  };
  'assistant.thinkingDelta': {
    content?: string;
    signature?: string;
    redacted?: boolean;
  };
  'assistant.thinkingFinalized': {
    signature?: string;
    redacted?: boolean;
  };
  'assistant.outputFallbackApplied': {
    content: string;
    reason: 'system_info_command' | 'provider_empty_result_policy';
  };
  'assistant.truncationSuspected': {
    warning: string;
  };
  'tool.started': ToolEventPayload;
  'tool.activity': {
    toolUseId: string;
    content: string;
  };
  'tool.finished': ToolEventPayload & {
    output?: unknown;
    isError?: boolean;
  };
  'tool.failed': ToolEventPayload & {
    error: string;
  };
  'tool.effectDetected': {
    toolUseId: string;
    toolName: string;
    effect: ToolEffect;
  };
  'interaction.todoUpdated': {
    interactionId: string;
    todos: unknown[];
  };
  'interaction.todoAutoCompleted': {
    interactionId: string;
    todos: unknown[];
  };
  'interaction.promptRequested': {
    interactionId: string;
    title?: string;
  };
  'interaction.resolved': {
    interactionId: string;
    resolution?: unknown;
  };
  'mode.changed': {
    mode: string;
    reason?: 'enter' | 'exit' | 'sync';
  };
  'mode.aiInitiatedPlanEntered': {
    originalMode: string;
  };
  'mode.aiInitiatedPlanExited': {
    nextMode: string;
  };
  'backgroundTask.started': BackgroundTaskPayload;
  'backgroundTask.updated': BackgroundTaskPayload & {
    status?: string;
    message?: string;
  };
  'backgroundTask.finished': BackgroundTaskPayload & {
    status: 'completed' | 'failed' | 'stopped';
    message?: string;
  };
  'backgroundTask.pidResolved': BackgroundTaskPayload & {
    cliPid?: number;
    taskRootPid: number;
  };
  'backgroundFollowup.started': {
    followupRunId: string;
  };
  'backgroundFollowup.finished': {
    followupRunId: string;
  };
  'compaction.requested': {
    source: 'preflight' | 'auto' | 'overflow' | 'manual';
  };
  'compaction.completed': {
    compactionId: string;
    tokensBefore: number;
  };
  'compaction.failed': {
    reason: string;
    breakerOpen: boolean;
    nextRetryAtMs?: number;
  };
  'compaction.skipped': {
    reason: string;
    tokensBefore?: number;
  };
  'permission.requested': {
    requestId: string;
    toolName: string;
  };
  'permission.resolved': {
    requestId: string;
    behavior: 'allow' | 'deny';
  };
  'permission.autoResolved': {
    requestId: string;
    behavior: 'allow' | 'deny';
    reason?: string;
  };
  'run.phaseChanged': {
    previousPhase: RunPhase;
    nextPhase: RunPhase;
  };
}

export interface ToolEventPayload {
  toolUseId: string;
  toolName: string;
  input?: unknown;
  semantic?: ToolSemantic;
  effect?: ToolEffect;
}

export interface BackgroundTaskPayload {
  taskId?: string;
  taskToolUseId?: string;
  taskCommand?: string;
  cliPid?: number;
  taskRootPid?: number;
}

export function createRunDomainEvent<TType extends RunDomainEventType>(input: {
  eventId?: string;
  type: TType;
  occurredAt?: number;
  runId: string;
  sessionId: string;
  providerType?: string;
  seq: number;
  source: RunDomainEventSource;
  cause?: RunDomainEventCause;
  payload: RunDomainEventPayloadMap[TType];
}): RunDomainEvent<TType> {
  return {
    eventId: input.eventId ?? newId(),
    type: input.type,
    version: 1,
    occurredAt: input.occurredAt ?? Date.now(),
    runId: input.runId,
    sessionId: input.sessionId,
    ...(input.providerType ? { providerType: input.providerType } : {}),
    seq: input.seq,
    source: input.source,
    ...(input.cause ? { cause: input.cause } : {}),
    payload: input.payload,
  } as RunDomainEvent<TType>;
}
