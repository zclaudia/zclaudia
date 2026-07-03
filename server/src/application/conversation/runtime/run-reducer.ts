import { generateToolSignature } from '../../../loop-detection.js';
import type { ActiveRun } from '../transport/types.js';
import { computeBlockers, recomputePhase } from './active-run-phase.js';
import type { RunDomainEvent } from './run-domain-events.js';

export function applyRunDomainEvent(activeRun: ActiveRun, event: RunDomainEvent): void {
  switch (event.type) {
    case 'assistant.textDelta':
      applyAssistantTextDelta(activeRun, event.payload.content);
      return;

    case 'assistant.thinkingDelta':
      applyThinkingDelta(activeRun, event.payload);
      return;

    case 'tool.started':
      applyToolStarted(activeRun, event.payload);
      return;

    case 'tool.finished':
      applyToolFinished(activeRun, event.payload);
      return;

    case 'backgroundTask.started':
      activeRun.pendingBackgroundTasks = (activeRun.pendingBackgroundTasks || 0) + 1;
      recomputePhase(activeRun, computeBlockers(activeRun));
      return;

    case 'backgroundTask.finished':
      activeRun.pendingBackgroundTasks = Math.max(0, (activeRun.pendingBackgroundTasks || 0) - 1);
      recomputePhase(activeRun, computeBlockers(activeRun));
      return;

    default:
      return;
  }
}

function applyAssistantTextDelta(activeRun: ActiveRun, content: string): void {
  activeRun.fullContent += content;
  const lastBlock = activeRun.contentBlocks[activeRun.contentBlocks.length - 1];
  if (lastBlock && lastBlock.type === 'text') {
    lastBlock.content += content;
  } else {
    activeRun.contentBlocks.push({ type: 'text', content });
  }
}

function applyThinkingDelta(
  activeRun: ActiveRun,
  delta: { content?: string; signature?: string; redacted?: boolean }
): void {
  activeRun.thinkingBlocks ??= [];
  let current = activeRun.thinkingBlocks[activeRun.thinkingBlocks.length - 1];
  if (!current && delta.content) {
    current = { text: '' };
    activeRun.thinkingBlocks.push(current);
  }
  if (!current) return;

  if (delta.content) current.text += delta.content;
  if (delta.signature) current.signature = delta.signature;
  if (delta.redacted !== undefined) current.redacted = delta.redacted;
}

function applyToolStarted(
  activeRun: ActiveRun,
  payload: RunDomainEvent<'tool.started'>['payload']
): void {
  const inputRecord = payload.input as Record<string, unknown> | undefined;
  const toolSignature = generateToolSignature(
    payload.toolName,
    inputRecord,
    activeRun.providerType
  );
  activeRun.recentToolCalls.push(toolSignature);
  if (activeRun.recentToolCalls.length > 20) {
    activeRun.recentToolCalls.shift();
  }

  activeRun.collectedToolCalls.push({
    toolUseId: payload.toolUseId,
    name: payload.toolName,
    input: payload.input,
    effect: payload.effect,
    startedAt: Date.now(),
  });
  activeRun.contentBlocks.push({ type: 'tool_use', toolUseId: payload.toolUseId });
}

function applyToolFinished(
  activeRun: ActiveRun,
  payload: RunDomainEvent<'tool.finished'>['payload']
): void {
  const collected = activeRun.collectedToolCalls.find(tc => tc.toolUseId === payload.toolUseId);
  if (!collected) return;
  collected.output = payload.output;
  collected.isError = payload.isError || false;
  collected.completedAt = Date.now();
  if (payload.effect) collected.effect = payload.effect;
}
