import { randomUUID } from 'node:crypto';
import type {
  DesignWorkbenchRequest,
  DesignWorkbenchResponse,
  DesignWorkbenchResult,
  DesignWorkbenchCancel,
} from '@zclaudia/shared/wire/messages/design';

interface Target {
  clientId: string;
  send: (message: DesignWorkbenchRequest | DesignWorkbenchCancel) => void;
  signal?: AbortSignal;
}

const failure = (code: string, message: string): DesignWorkbenchResult => ({
  ok: false,
  code,
  message,
});

/** Only the client that started this session's run may answer. No broadcast or replay. */
export class DesignAgentBridge {
  private target: (sessionId: string) => Target | undefined = () => undefined;
  private pending = new Map<
    string,
    {
      sessionId: string;
      clientId: string;
      finish: (result: DesignWorkbenchResult) => void;
    }
  >();

  configure(resolveTarget: (sessionId: string) => Target | undefined): void {
    this.target = resolveTarget;
  }

  request(
    sessionId: string,
    input: Pick<DesignWorkbenchRequest, 'action' | 'path' | 'expectedRevision'>,
    timeoutMs = 12_000
  ): Promise<DesignWorkbenchResult> {
    const target = this.target(sessionId);
    if (!target || target.signal?.aborted) {
      return Promise.resolve(
        failure('UI_UNAVAILABLE', 'No connected run client for this session.')
      );
    }
    const requestId = randomUUID();
    return new Promise(resolve => {
      const finish = (result: DesignWorkbenchResult) => {
        if (!this.pending.delete(requestId)) return;
        clearTimeout(timer);
        target.signal?.removeEventListener('abort', abort);
        resolve(result);
      };
      const cancel = (result: DesignWorkbenchResult) => {
        finish(result);
        try {
          target.send({ type: 'design_workbench_cancel', requestId, sessionId });
        } catch {
          /* disconnected */
        }
      };
      const abort = () => cancel(failure('CANCELLED', 'The design request was cancelled.'));
      const timer = setTimeout(
        () => cancel(failure('UI_TIMEOUT', 'The Design panel did not acknowledge in time.')),
        timeoutMs
      );
      this.pending.set(requestId, { sessionId, clientId: target.clientId, finish });
      target.signal?.addEventListener('abort', abort, { once: true });
      try {
        target.send({
          type: 'design_workbench_request',
          requestId,
          sessionId,
          expiresAt: Date.now() + timeoutMs,
          ...input,
        });
      } catch {
        finish(failure('UI_UNAVAILABLE', 'The run client could not be reached.'));
      }
    });
  }

  respond(clientId: string, message: DesignWorkbenchResponse): boolean {
    const pending = this.pending.get(message.requestId);
    if (!pending || pending.clientId !== clientId || pending.sessionId !== message.sessionId)
      return false;
    const result = message.result;
    // The result is frontend observation, never executable instructions. Bound its size.
    if (
      !result ||
      typeof result.ok !== 'boolean' ||
      JSON.stringify(result).length > 64_000 ||
      (result.ok && (!result.context || typeof result.displayed !== 'boolean')) ||
      (!result.ok && (typeof result.code !== 'string' || typeof result.message !== 'string'))
    ) {
      pending.finish(failure('INVALID_RESPONSE', 'Invalid Design panel response.'));
      return false;
    }
    pending.finish(result);
    return true;
  }
}

export const designAgentBridge = new DesignAgentBridge();
