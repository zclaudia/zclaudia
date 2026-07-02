// Periodic backend heartbeat for the gateway client. Extracted from GatewayClient so the
// timer lifecycle is a cohesive, independently testable unit (QA-0027).
import type { BackendHeartbeatMessage } from '@zclaudia/protocol/gateway';

export interface HeartbeatDeps {
  /** Interval between heartbeats, in milliseconds. */
  intervalMs: number;
  /** Whether the connection is currently in a state that can send. */
  canSend: () => boolean;
  /** Current connection epoch, or null/0 when not established. */
  currentEpoch: () => number | null;
  /** Sends a heartbeat message over the gateway WebSocket. */
  send: (msg: BackendHeartbeatMessage) => void;
}

export class GatewayHeartbeat {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: HeartbeatDeps) {}

  /** (Re)starts the heartbeat timer, replacing any existing one. */
  start(): void {
    this.stop();
    this.timer = setInterval(() => {
      const epoch = this.deps.currentEpoch();
      if (!this.deps.canSend() || !epoch) return;
      this.deps.send({ type: 'backend_heartbeat', epoch, observedAt: Date.now() });
    }, this.deps.intervalMs);
  }

  /** Stops the heartbeat timer if running. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
