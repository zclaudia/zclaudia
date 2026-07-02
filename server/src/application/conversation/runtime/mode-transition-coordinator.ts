import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { ProviderRegistryPort } from '../../../infra/providers/registry.js';
import type { ProviderRuntimeEvent } from '../../../infra/providers/types.js';
import type { ActiveRun } from '../transport/types.js';
import { dispatchProviderRuntimeEventToDomain } from './run-domain-dispatcher.js';

export interface HandleModeTransitionInput {
  activeRun: ActiveRun;
  modeValue: string;
  msg: ProviderRuntimeEvent;
  providerRegistry: ProviderRegistryPort;
  providerType: string;
  runId: string;
  sendRunEvent: (event: ServerMessage) => void;
}

export function handleModeTransition(input: HandleModeTransitionInput): void {
  const { activeRun, modeValue, msg, providerRegistry, providerType, runId, sendRunEvent } = input;
  const transition = msg.modeTransition;
  if (!transition) return;

  const targetMode = transition.mode;
  dispatchProviderRuntimeEventToDomain({
    activeRun,
    providerEvent: msg,
    providerType,
    runId,
    sendRunEvent,
  });

  if (transition.reason === 'enter') {
    if (modeValue !== 'plan') {
      activeRun.aiInitiatedPlanMode = true;
      activeRun.originalMode = activeRun.originalMode ?? modeValue;
      console.log(
        `[Permission] AI entered plan mode during ${modeValue} run (provider=${activeRun.providerType})`
      );
    }
  } else if (transition.reason === 'exit') {
    activeRun.aiInitiatedPlanMode = false;
  }

  const adapter = activeRun.providerType ? providerRegistry.get(activeRun.providerType) : undefined;
  adapter?.setSessionMode?.(activeRun.sessionId, targetMode);
}
