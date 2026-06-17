import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { ProviderRuntimeEvent } from '../../../infra/providers/types.js';
import type { ActiveRun } from '../transport/types.js';
import { applyRunDomainEvent } from './run-reducer.js';
import {
  translateProviderRuntimeEvent,
  type TranslateProviderRuntimeEventInput,
} from './provider-event-translator.js';
import { projectRunDomainEventToWireMessages } from './wire-projector.js';
import type { RunDomainEvent } from './run-domain-events.js';
import {
  runDomainEventListeners,
  type RunDomainEventListenerRegistry,
} from './run-domain-event-listeners.js';

export interface DispatchProviderRuntimeEventInput {
  activeRun: ActiveRun;
  providerEvent: ProviderRuntimeEvent;
  providerType: string;
  runId: string;
  sendRunEvent: (event: ServerMessage) => void;
  listeners?: RunDomainEventListenerRegistry;
}

export function dispatchProviderRuntimeEventToDomain(
  input: DispatchProviderRuntimeEventInput,
): RunDomainEvent[] {
  const domainEvents = translateProviderRuntimeEvent({
    event: input.providerEvent,
    runId: input.runId,
    sessionId: input.activeRun.sessionId,
    providerType: input.providerType,
    seq: (input.activeRun.eventSeq ?? 0) + 1,
  } satisfies TranslateProviderRuntimeEventInput);

  for (const event of domainEvents) {
    applyRunDomainEvent(input.activeRun, event);
    for (const wireEvent of projectRunDomainEventToWireMessages(event)) {
      input.sendRunEvent(stripProjectedSeq(wireEvent));
    }
    (input.listeners ?? runDomainEventListeners).emit(event);
  }

  return domainEvents;
}

function stripProjectedSeq(event: ServerMessage): ServerMessage {
  const eventForSend = { ...event };
  if ('seq' in eventForSend) {
    delete (eventForSend as { seq?: number }).seq;
  }
  return eventForSend;
}
