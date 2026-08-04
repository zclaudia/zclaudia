import { Info } from 'lucide-react';
import type { SettingsTargetBackend } from '../../../hooks/useSettingsTargetBackend';

/**
 * Informational banner shown at the top of device-level settings pages when
 * the settings target is not this device's local backend (e.g. on mobile,
 * where the pages configure the connected remote backend). Renders nothing
 * when the target is local or unresolved.
 */
export function TargetBackendBanner({ target }: { target: SettingsTargetBackend }) {
  if (!target.targetBackendId || target.isLocalTarget) return null;
  return (
    <div
      data-testid="settings-target-backend-banner"
      className="flex items-start gap-2 rounded-lg bg-secondary/50 p-2.5 text-xs text-muted-foreground"
    >
      <Info className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
      <span>
        These settings apply to the connected backend:{' '}
        <span className="text-foreground">{target.targetBackendName}</span>.
      </span>
    </div>
  );
}

/** Shown instead of a settings form when no backend is available at all. */
export function NoTargetBackendNotice() {
  return (
    <div
      data-testid="settings-no-backend-notice"
      className="rounded-lg bg-secondary/50 p-3 text-sm text-muted-foreground"
    >
      No backend is connected. Connect to a backend to manage these settings.
    </div>
  );
}
