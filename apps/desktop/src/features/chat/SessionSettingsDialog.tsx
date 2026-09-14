import { useEffect, useState } from 'react';
import type { SessionModelSettings } from '@zclaudia/shared';
import { Modal } from '../../components/ui/Modal';
import { getSessionModelSettings } from '../../services/api/sessions';
import { useSessionOverridesStore } from '../../stores/sessionOverridesStore';
import { useSessionConfigStore } from '../../stores/sessionConfigStore';
import { PermissionSelector } from './PermissionSelector';

export function SessionSettingsDialog({
  sessionId,
  disabled,
  isMobile,
  onClose,
}: {
  sessionId: string;
  disabled?: boolean;
  isMobile: boolean;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<SessionModelSettings | null>(null);
  const [error, setError] = useState('');
  const value = useSessionOverridesStore(s => s.permissionOverrides[sessionId] ?? null);
  const setPermission = useSessionOverridesStore(s => s.setPermissionOverride);
  const mode = useSessionConfigStore(
    s => s.runtimeModes[sessionId] || s.modeBySession[sessionId] || 'default'
  );
  useEffect(() => {
    const controller = new AbortController();
    getSessionModelSettings(sessionId, false, controller.signal)
      .then(setSettings)
      .catch(e => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Could not load settings');
      });
    return () => controller.abort();
  }, [sessionId]);
  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel="Session settings"
      title="Session settings"
      isMobile={isMobile}
    >
      <div className="space-y-3 p-4">
        <h3 className="text-sm font-medium">Permissions & approvals</h3>
        {!settings && !error && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading…
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {settings && (
          <>
            <p className="text-xs text-muted-foreground">{settings.permissionNote}</p>
            {mode === 'bypassPermissions' && (
              <p className="text-xs text-warning">
                Bypass mode approves native tool requests before these rules. Switch to Default to
                use host approvals.
              </p>
            )}
            {mode === 'acceptEdits' && (
              <p className="text-xs text-warning">
                Accept Edits mode may approve file changes before host rules are checked.
              </p>
            )}
            {settings.supportsPermissionOverrides ? (
              <PermissionSelector
                inline
                value={value}
                onChange={policy => setPermission(sessionId, policy)}
                disabled={disabled || mode === 'bypassPermissions'}
              />
            ) : (
              <p className="text-sm">CLI-managed permissions</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
