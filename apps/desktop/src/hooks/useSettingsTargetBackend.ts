import { useLocalBackendId } from './useLocalBackendId';
import { useServerStore } from '../stores/serverStore';
import { useFacadeStore } from '../stores/facadeStore';
import { isLegacyLocalBackendId } from '../utils/controlPlane';

export interface SettingsTargetBackend {
  /**
   * Backend these settings will read from and write to. Prefers this device's
   * local backend; falls back to the active backend (the only option on
   * mobile, which has no embedded server). Null when neither exists.
   */
  targetBackendId: string | null;
  /** True when the target is this device's own local backend. */
  isLocalTarget: boolean;
  /** Display name of the target backend (facade name, id-prefix fallback). */
  targetBackendName: string | null;
}

/**
 * Resolves which backend a device-level settings page actually edits.
 *
 * On desktop the embedded local backend always exists, so settings edit the
 * local machine even when a remote backend is active for chat. On mobile there
 * is no local backend and these pages are the only way to manage the connected
 * backend's settings — so the target explicitly falls back to the active
 * backend instead of relying on the api layer's silent null fallback.
 *
 * Pages must pass `targetBackendId` to every fetch/mutation, show
 * `TargetBackendBanner` so a non-local target is visible to the user, and
 * render a disabled notice when `targetBackendId` is null.
 */
export function useSettingsTargetBackend(): SettingsTargetBackend {
  const localBackendId = useLocalBackendId();
  const activeServerId = useServerStore(s => s.activeServerId);
  const backends = useFacadeStore(s => s.backends);

  const targetBackendId = localBackendId ?? activeServerId;

  const isLocalTarget =
    targetBackendId !== null &&
    (targetBackendId === localBackendId ||
      // Legacy 'local' sentinel ids always mean this device's backend.
      isLegacyLocalBackendId(targetBackendId));

  const targetBackendName = targetBackendId
    ? (backends.find(b => b.backendId === targetBackendId)?.name ??
      `Backend ${targetBackendId.slice(0, 8)}`)
    : null;

  return { targetBackendId, isLocalTarget, targetBackendName };
}
