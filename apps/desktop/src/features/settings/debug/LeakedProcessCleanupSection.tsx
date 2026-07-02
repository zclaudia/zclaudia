import { useState, useEffect, useCallback } from 'react';
import { useProcessMonitorStore } from '../../../stores/processMonitorStore';
import type { ClientMessage } from '@zclaudia/shared';
import { SettingsRow } from '../ui/SettingsGroup';

interface LeakedProcessCleanupSectionProps {
  isConnected: boolean;
  sendMessage: (msg: ClientMessage) => void;
}

export function LeakedProcessCleanupSection({
  isConnected,
  sendMessage,
}: LeakedProcessCleanupSectionProps) {
  const [leakCleanupRunning, setLeakCleanupRunning] = useState(false);
  const [leakCleanupResult, setLeakCleanupResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const cleanupResult = useProcessMonitorStore(state => state.lastCleanupResult);
  const clearCleanupResult = useProcessMonitorStore(state => state.clearCleanupResult);

  const handleLeakCleanup = useCallback(() => {
    if (!isConnected) {
      setLeakCleanupResult({
        ok: false,
        message: 'Connect to the server before running process cleanup.',
      });
      return;
    }
    setLeakCleanupRunning(true);
    clearCleanupResult();
    setLeakCleanupResult(null);
    try {
      sendMessage({ type: 'kill_leaked_processes' } as ClientMessage);
    } catch (err) {
      setLeakCleanupResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Failed to request process cleanup.',
      });
      setLeakCleanupRunning(false);
    }
  }, [clearCleanupResult, isConnected, sendMessage]);

  useEffect(() => {
    if (!cleanupResult) return;
    setLeakCleanupRunning(false);

    if (cleanupResult.status === 'skipped_active_runs') {
      setLeakCleanupResult({
        ok: false,
        message: `Cleanup skipped because ${cleanupResult.activeRunCount} active run(s) are still in progress.`,
      });
      return;
    }

    if (cleanupResult.status === 'clean') {
      setLeakCleanupResult({
        ok: true,
        message: 'Cleanup completed. No leaked child processes were found.',
      });
      return;
    }

    setLeakCleanupResult({
      ok: cleanupResult.killedCount > 0,
      message:
        cleanupResult.killedCount > 0
          ? `Cleanup completed. Terminated ${cleanupResult.killedCount} of ${cleanupResult.leakedCount} leaked process(es).`
          : `Cleanup completed, but none of the ${cleanupResult.leakedCount} leaked process(es) could be terminated.`,
    });
  }, [cleanupResult]);

  return (
    <SettingsRow
      align="start"
      title="Leaked process cleanup"
      description="Trigger an immediate server-side scan for orphaned provider child processes and terminate any matches."
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {isConnected ? 'Connected to active server' : 'Server disconnected'}
          </div>
          <button
            onClick={handleLeakCleanup}
            disabled={leakCleanupRunning || !isConnected}
            className="px-3 py-1 text-xs bg-destructive hover:bg-destructive/90 disabled:bg-muted disabled:text-muted-foreground text-destructive-foreground rounded-lg font-medium transition-colors"
          >
            {leakCleanupRunning ? 'Cleaning…' : 'Clean Leaked Processes'}
          </button>
        </div>
        {leakCleanupResult && (
          <div className={`text-xs ${leakCleanupResult.ok ? 'text-success' : 'text-destructive'}`}>
            {leakCleanupResult.message}
          </div>
        )}
      </div>
    </SettingsRow>
  );
}
