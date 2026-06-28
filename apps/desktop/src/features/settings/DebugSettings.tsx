import type { ClientMessage } from '@zclaudia/shared';
import { DebugGroup } from './debug/DebugGroup';
import { CrashReportsSection } from './debug/CrashReportsSection';
import { ManagedProcessesSection } from './debug/ManagedProcessesSection';
import { ClientLogsSection } from './debug/ClientLogsSection';
import { PermissionLogsSection } from './debug/PermissionLogsSection';
import { LeakedProcessCleanupSection } from './debug/LeakedProcessCleanupSection';
import { AiReviewSimulatorSection } from './debug/AiReviewSimulatorSection';

interface DebugSettingsProps {
  isConnected: boolean;
  sendMessage: (msg: ClientMessage) => void;
  embeddedServerStatus: string;
}

export function DebugSettings({ isConnected, sendMessage, embeddedServerStatus }: DebugSettingsProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Debug</h3>
      <p className="text-sm text-muted-foreground">Diagnostics and troubleshooting tools.</p>

      <div className="space-y-6">
        <DebugGroup label="Diagnostics">
          <CrashReportsSection embeddedServerStatus={embeddedServerStatus} />
          <ManagedProcessesSection embeddedServerStatus={embeddedServerStatus} />
        </DebugGroup>

        <DebugGroup label="Logs">
          <ClientLogsSection />
          <PermissionLogsSection />
        </DebugGroup>

        <DebugGroup label="Tools">
          <LeakedProcessCleanupSection isConnected={isConnected} sendMessage={sendMessage} />
          <AiReviewSimulatorSection />
        </DebugGroup>
      </div>
    </div>
  );
}
