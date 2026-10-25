import type {
  DesignWorkbenchContext,
  DesignWorkbenchRequest,
  DesignWorkbenchResult,
} from '@zclaudia/shared/wire/messages/design';
import type { ServerMessage } from '@zclaudia/shared/wire/messages/index';
import { activatePanel, currentSessionCtx, isPanelAvailable } from '../../actions/openPanel';
import { resolveCanonicalBackendId } from '../../actions/controlPlane';
import { useFacadeStore } from '../../stores/facadeStore';
import { usePluginStore } from '../../stores/pluginStore';

export interface DesignAgentBinding {
  context: () => DesignWorkbenchContext;
  visible: () => boolean;
  present: (
    request: DesignWorkbenchRequest,
    alive: () => boolean
  ) => Promise<DesignWorkbenchResult>;
}

const bindings = new Map<string, DesignAgentBinding>();
const inFlight = new Set<string>();
const seen = new Set<string>();
const cancelled = new Set<string>();
const trimIds = (ids: Set<string>) => {
  const oldest = ids.values().next().value;
  if (ids.size > 256 && oldest !== undefined) ids.delete(oldest);
};
const keyOf = (backendId: string, sessionId: string) =>
  JSON.stringify([resolveCanonicalBackendId(backendId), sessionId]);
export const designFailure = (code: string, message: string): DesignWorkbenchResult => ({
  ok: false,
  code,
  message,
});

export function registerDesignAgentBinding(
  backendId: string,
  sessionId: string,
  binding: DesignAgentBinding
): () => void {
  const key = keyOf(backendId, sessionId);
  bindings.set(key, binding);
  return () => {
    if (bindings.get(key) === binding) bindings.delete(key);
  };
}

export async function executeDesignRequest(
  backendId: string,
  request: DesignWorkbenchRequest
): Promise<DesignWorkbenchResult> {
  const key = keyOf(backendId, request.sessionId);
  const isCurrent = () => {
    const current = currentSessionCtx();
    return (
      current.sessionId === request.sessionId &&
      resolveCanonicalBackendId(current.backendId) === resolveCanonicalBackendId(backendId)
    );
  };
  const deadline = Math.min(request.expiresAt, Date.now() + 10_000);
  const alive = () =>
    Date.now() < deadline && isCurrent() && !cancelled.has(keyOf(backendId, request.requestId));
  if (!Number.isFinite(deadline) || !alive())
    return designFailure(
      'SESSION_NOT_VISIBLE',
      'The request expired or its session is no longer in the foreground.'
    );
  const existing = bindings.get(key);
  if (request.action === 'get_context') {
    return existing?.visible()
      ? { ok: true, displayed: false, context: existing.context() }
      : designFailure(
          'PANEL_CLOSED',
          'Design is not visible. Current selection and unsaved draft state are unknown.'
        );
  }
  if (request.action !== 'present' || !request.path || !request.expectedRevision)
    return designFailure('INVALID_ARGUMENT', 'An HTML path and revision are required.');
  if (inFlight.has(key))
    return designFailure('BUSY', 'Another design presentation is in progress.');
  const context = { sessionId: request.sessionId, backendId };
  if (!isPanelAvailable('design', context))
    return designFailure('UI_UNAVAILABLE', 'Design is unavailable on this client.');
  inFlight.add(key);
  try {
    usePluginStore.getState().updatePanelVisibility('design', true);
    activatePanel('design', context);
    while (alive()) {
      const binding = bindings.get(key);
      if (binding?.visible()) {
        return await binding.present(request, () => alive() && bindings.get(key) === binding);
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return designFailure('UI_TIMEOUT', 'Design did not become visible before the request expired.');
  } finally {
    inFlight.delete(key);
  }
}

/** One response on the exact backend that sent the request; never uses the active backend fallback. */
export function handleDesignMessage(message: ServerMessage, backendId?: string): boolean {
  if (message.type === 'design_workbench_cancel') {
    if (backendId) {
      cancelled.add(keyOf(backendId, message.requestId));
      trimIds(cancelled);
    }
    return true;
  }
  if (message.type !== 'design_workbench_request') return false;
  if (!backendId) return true;
  const canonical = resolveCanonicalBackendId(backendId) ?? backendId;
  const id = keyOf(canonical, message.requestId);
  if (seen.has(id)) return true;
  seen.add(id);
  trimIds(seen);
  const facade = useFacadeStore.getState().facade;
  if (!facade) return true;
  void executeDesignRequest(canonical, message)
    .catch(() => designFailure('DESIGN_ERROR', 'The Design panel could not complete this request.'))
    .then(result => {
      if (useFacadeStore.getState().facade !== facade) return;
      facade.sendToBackend(canonical, {
        type: 'design_workbench_response',
        requestId: message.requestId,
        sessionId: message.sessionId,
        result,
      });
    })
    .catch(() => {
      /* A disconnected client cannot acknowledge; the server times out. */
    });
  return true;
}
