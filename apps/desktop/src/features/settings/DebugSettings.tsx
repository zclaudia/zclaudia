import type { ClientMessage } from '@zclaudia/shared/wire/messages/index';
import { SettingsGroup } from './ui/SettingsGroup';
import { CrashReportsSection } from './debug/CrashReportsSection';
import { ManagedProcessesSection } from './debug/ManagedProcessesSection';
import { ClientLogsSection } from './debug/ClientLogsSection';
import { PermissionLogsSection } from './debug/PermissionLogsSection';
import { LeakedProcessCleanupSection } from './debug/LeakedProcessCleanupSection';
import { AiReviewSimulatorSection } from './debug/AiReviewSimulatorSection';
import { useSettingsSurface } from './settingsSurface';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useAppearanceStore } from '../../stores/appearanceStore';
import { Toggle } from '../../components/ui/Toggle';

interface DebugSettingsProps {
  isConnected: boolean;
  sendMessage: (msg: ClientMessage) => void;
}

export function DebugSettings({ isConnected, sendMessage }: DebugSettingsProps) {
  const isMobile = useIsMobile();
  const chatCard = useAppearanceStore(s => s.chatCard);
  const unifiedWorkspace = useAppearanceStore(s => s.unifiedWorkspace);
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
        {!isMobile && (
          <SettingsGroup label="Desktop experiments">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Chat card</div>
                <p className="text-xs text-muted-foreground">Display chat in a workspace card.</p>
              </div>
              <Toggle
                checked={chatCard}
                onChange={useAppearanceStore.getState().setChatCard}
                aria-label="Chat card"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Unified workspace</div>
                <p className="text-xs text-muted-foreground">Arrange chat alongside tool panes.</p>
              </div>
              <Toggle
                checked={unifiedWorkspace}
                onChange={useAppearanceStore.getState().setUnifiedWorkspace}
                aria-label="Unified workspace"
              />
            </div>
          </SettingsGroup>
        )}
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
