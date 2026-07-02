import type { ActiveRun } from '../../application/conversation/transport/types.js';
import { isTerminalPhase } from '../../application/conversation/runtime/active-run-phase.js';

/**
 * When a gateway channel closes (remote/mobile client disconnects),
 * keep active runs alive — the client may reconnect and resume.
 * This mirrors the behavior of direct WebSocket client disconnections
 * (server.ts close handler).
 *
 * Only log orphaned runs for observability.
 */
export function handleChannelClosed(channelId: string, activeRuns: Map<string, ActiveRun>): void {
  const orphanedRunIds: string[] = [];
  for (const [runId, run] of activeRuns) {
    if (run.clientId === channelId && !isTerminalPhase(run.phase)) {
      orphanedRunIds.push(runId);
    }
  }
  if (orphanedRunIds.length > 0) {
    console.log(
      `[Gateway] Channel ${channelId} closed with ${orphanedRunIds.length} active run(s) — keeping alive for reconnect`
    );
  }
}
