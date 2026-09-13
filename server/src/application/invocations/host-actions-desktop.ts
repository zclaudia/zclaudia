import { hostActionRegistry } from './host-actions.js';
import { DESKTOP_HOST_ACTIONS } from '@zclaudia/shared/features/host-actions';

/**
 * Canonical desktop host actions (URIP design doc §12.4).
 *
 * Every former hard-coded composer branch is registered as a client-executed
 * host action: the catalog lists it under its `/zc:` trigger, and the desktop
 * dispatches the registered `clientActionId` locally. The server holds no body
 * for these — a raw `/zc:<name>` typed as text is answered with an
 * `invocation_result{client-action}` carrying only the registered action ID.
 */
export function registerDesktopHostActions(): void {
  for (const action of DESKTOP_HOST_ACTIONS) {
    if (hostActionRegistry.has(action.name)) continue;
    hostActionRegistry.register(action.name, {
      executionLocus: 'client',
      clientActionId: action.clientActionId,
      descriptor: {
        label: action.label,
        description: action.description,
        ...(action.argumentHint ? { argumentHint: action.argumentHint } : {}),
        aliases: action.aliases,
        origin: { owner: 'host', scope: 'system' },
      },
    });
  }
}
