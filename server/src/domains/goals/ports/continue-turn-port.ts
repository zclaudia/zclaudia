import type { ContinueTurnPort } from '../coordinator.js';
import type { ConnectedClient } from '../../../application/conversation/transport/types.js';
import { newId } from '../../../utils/uuid.js';

/**
 * ContinueTurnPortImpl — synthesizes a run_start message and dispatches it
 * through the same handleRunStart path as a user-typed message.
 *
 * `handleRunStart` here is the WRAPPED variant from domain-bootstrap.ts that
 * already injects RunHandlerContext via serverState.getRunHandlerContext().
 * We pass `undefined` for ctx (5th positional argument) so the wrapper supplies it.
 */
export interface ContinueTurnDeps {
  /** Pre-wrapped handleRunStart that injects RunHandlerContext internally. */
  handleRunStart: (
    client: ConnectedClient,
    message: Record<string, unknown>,
    db: unknown,
    recoveryState?: Record<string, unknown>,
    clients?: Map<string, ConnectedClient>
  ) => Promise<void>;
  db: unknown;
  clients: Map<string, ConnectedClient>;
  resolveLlmProfileId(sessionId: string): string | null;
  resolveWorkingDirectory(sessionId: string): string;
}

export class ContinueTurnPortImpl implements ContinueTurnPort {
  constructor(private readonly deps: ContinueTurnDeps) {}

  async appendAndRun(
    sessionId: string,
    text: string,
    metadata: { source: 'goal-auto'; goalId: string }
  ): Promise<void> {
    const syntheticClient: ConnectedClient = {
      id: `goal-auto-${sessionId}`,
      ws: { send: () => {}, readyState: 1 } as unknown as import('ws').WebSocket,
      isAlive: true,
      isLocal: true,
      authenticated: true,
    };

    const llmProfileId = this.deps.resolveLlmProfileId(sessionId);
    const workingDirectory = this.deps.resolveWorkingDirectory(sessionId);

    const message: Record<string, unknown> = {
      type: 'run_start',
      clientRequestId: newId(),
      sessionId,
      input: text,
      workingDirectory,
      userMessageMetadata: metadata,
      ...(llmProfileId != null ? { llmProfileId } : {}),
    };

    await this.deps.handleRunStart(syntheticClient, message, this.deps.db, {}, this.deps.clients);
  }
}
