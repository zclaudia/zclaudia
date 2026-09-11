import type {
  ExternalAgentAdapter,
  ExternalAgentRunContext,
  ExternalAgentRunState,
  PermissionCallback,
  ProviderRuntimeEvent,
} from '@zclaudia/plugin-sdk/providers';
import { AdapterSessionState, type ToolBridgeFactory } from '@zclaudia/agent-common';
import { runCursor, abortCursorSession } from './runner.js';

export type { ToolBridgeFactory } from '@zclaudia/agent-common';

export class CursorAgentAdapter implements ExternalAgentAdapter {
  readonly type = 'cursor';
  private readonly sessions = new AdapterSessionState({ trackModes: true });

  constructor(private readonly createToolBridge: ToolBridgeFactory) {}

  async *run(
    input: string,
    context: ExternalAgentRunContext,
    _onPermission?: PermissionCallback
  ): AsyncGenerator<ProviderRuntimeEvent, void, void> {
    const session = this.sessions.begin(context);
    const effectiveMode = this.sessions.effectiveMode(context);

    try {
      const bridge = await this.createToolBridge({
        serverPort: context.serverPort,
        sessionId: context.claudiaSessionId,
      });
      for await (const event of runCursor(input, {
        cwd: context.cwd,
        sessionId: context.sessionId,
        cliPath: context.cliPath,
        env: context.env,
        model: context.model,
        mode: effectiveMode as 'plan' | 'ask' | undefined,
        systemPrompt: context.systemPrompt,
        serverPort: context.serverPort,
        claudiaSessionId: context.claudiaSessionId,
        abortController: session.abortController,
        bridge,
        onSessionId: id => {
          this.sessions.registerProviderSession(session, id);
        },
      })) {
        this.sessions.observe(session, event);
        yield event;
      }
    } finally {
      this.sessions.finish(session);
    }
  }

  getRunState(context: ExternalAgentRunContext): ExternalAgentRunState {
    return this.sessions.getRunState(context);
  }

  setSessionMode(sessionId: string, mode: string): void {
    this.sessions.setSessionMode(sessionId, mode);
  }

  async abort(sessionId: string, _cwd: string): Promise<void> {
    this.sessions.abort(sessionId);
    await abortCursorSession(sessionId);
  }
}
