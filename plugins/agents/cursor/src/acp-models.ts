import { CursorAcpError } from './errors.js';
import type { CursorSessionModelsState } from './cursor-acp-extensions.js';

/**
 * Resolve the exact ACP `modelId` for a requested bare model name
 * (design doc §7.4).
 *
 * Cursor's `modelId` carries bracket parameters (`claude-opus-5[thinking=true,
 * context=300k,...]`) while ZClaudia's `context.model` stores the bare name.
 * `session/set_model` requires the exact parameterized id, so matching is:
 *
 * 1. exact `modelId` equality (covers saved full parameterized strings);
 * 2. exact `name` equality → that entry's `modelId`;
 * 3. no match with an explicitly requested model → fast-fail with
 *    `CURSOR_MODEL_UNSUPPORTED`; never silently fall back to `default[]`.
 *
 * An empty/absent request keeps the session's `currentModelId` and skips
 * `session/set_model` entirely.
 */
export function resolveAcpModelId(
  models: CursorSessionModelsState | undefined,
  requestedModel: string | undefined
): { modelId?: string; displayName?: string } {
  if (!requestedModel || !requestedModel.trim()) {
    return {};
  }
  const requested = requestedModel.trim();
  if (!models || models.availableModels.length === 0) {
    throw new CursorAcpError(
      'CURSOR_MODEL_UNSUPPORTED',
      `Model "${requested}" was requested, but the agent did not report an available model list. Retry without an explicit model.`
    );
  }
  const exact = models.availableModels.find(m => m.modelId === requested);
  if (exact) return { modelId: exact.modelId, displayName: exact.name };
  const byName = models.availableModels.find(m => m.name === requested);
  if (byName) return { modelId: byName.modelId, displayName: byName.name };
  throw new CursorAcpError(
    'CURSOR_MODEL_UNSUPPORTED',
    `Model "${requested}" is not offered by this Cursor CLI session. Available: ${models.availableModels
      .slice(0, 8)
      .map(m => m.name)
      .join(', ')}${models.availableModels.length > 8 ? ', …' : ''}.`
  );
}

/**
 * Validate the requested ZClaudia mode against the session's advertised modes
 * (design doc §8.1). Mode ids come from `availableModes` — display names are
 * not stable ids. `bypassPermissions` maps onto `agent` (the runtime answers
 * permission requests itself), and the supervised default also runs `agent`.
 */
export function resolveAcpModeId(
  availableModes: Array<{ id: string; name: string }> | undefined,
  currentModeId: string | undefined,
  requestedMode: string | undefined
): { modeId?: string; warning?: string } {
  const ids = new Set((availableModes ?? []).map(m => m.id));
  const target = requestedMode === 'plan' ? 'plan' : requestedMode === 'ask' ? 'ask' : 'agent';
  if (ids.size === 0) {
    if (target === 'agent') return {}; // Nothing advertised: default to the session's own mode.
    throw new CursorAcpError(
      'CURSOR_ACP_MODE_UNSUPPORTED',
      `Mode "${requestedMode}" was requested but the agent advertised no modes.`
    );
  }
  if (!ids.has(target)) {
    throw new CursorAcpError(
      'CURSOR_ACP_MODE_UNSUPPORTED',
      `Mode "${target}" is not available in this Cursor session (available: ${[...ids].join(', ')}).`
    );
  }
  if (target === 'agent' && currentModeId === 'agent') return {}; // Already there.
  if (target === currentModeId) return {}; // Already there.
  return { modeId: target };
}
