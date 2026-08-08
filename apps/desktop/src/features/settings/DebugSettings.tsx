import type { ClientMessage } from '@zclaudia/shared';
import { SettingsGroup } from './ui/SettingsGroup';
import { CrashReportsSection } from './debug/CrashReportsSection';
import { ManagedProcessesSection } from './debug/ManagedProcessesSection';
import { ClientLogsSection } from './debug/ClientLogsSection';
import { PermissionLogsSection } from './debug/PermissionLogsSection';
import { LeakedProcessCleanupSection } from './debug/LeakedProcessCleanupSection';
import { AiReviewSimulatorSection } from './debug/AiReviewSimulatorSection';
import { useSettingsSurface } from './settingsSurface';

interface DebugSettingsProps {
  isConnected: boolean;
  sendMessage: (msg: ClientMessage) => void;
}

export function DebugSettings({ isConnected, sendMessage }: DebugSettingsProps) {
  // Reading a backend's diagnostics travels fine; acting on its host does not.
  // On a phone the Tools group has nothing left in it, so it is dropped whole
  // rather than left as an empty labeled card.
  const cleanup = useSettingsSurface('debug.process-cleanup');
  const simulator = useSettingsSurface('debug.ai-review-simulator');
  const showTools = cleanup.visible || simulator.visible;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Debug</h3>
      <p className="text-sm text-muted-foreground">Diagnostics and troubleshooting tools.</p>

      <div className="space-y-6">
        <SettingsGroup label="Diagnostics">
          <CrashReportsSection />
          <ManagedProcessesSection />
        </SettingsGroup>

        <SettingsGroup label="Logs">
          <ClientLogsSection />
          <PermissionLogsSection />
        </SettingsGroup>

        {showTools && (
          <SettingsGroup label="Tools">
            {cleanup.visible && (
              <LeakedProcessCleanupSection isConnected={isConnected} sendMessage={sendMessage} />
            )}
            {simulator.visible && <AiReviewSimulatorSection />}
          </SettingsGroup>
        )}
      </div>
    </div>
  );
}
