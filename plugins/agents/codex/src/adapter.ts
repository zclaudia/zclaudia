import type {
  ExternalAgentAdapter,
  ExternalAgentRunContext,
  ExternalAgentRunState,
  PermissionCallback,
  ProviderRuntimeEvent,
  ProviderToolBridgeEntry,
} from '@zclaudia/plugin-sdk/providers';
import { AdapterSessionState, type ToolBridgeFactory } from '@zclaudia/agent-common';
import { runCodexAppServer, runCodexSdkTurn, abortCodexSession, type CodexRunOptions } from './runner.js';

export type { ToolBridgeFactory } from '@zclaudia/agent-common';

export class CodexAgentAdapter implements ExternalAgentAdapter {
  readonly type = 'codex';
  private readonly sessions = new AdapterSessionState({ trackModes: true });

  constructor(private readonly createToolBridge: ToolBridgeFactory) {}

  async *run(
    input: string,
    context: ExternalAgentRunContext,
    onPermission?: PermissionCallback
  ): AsyncGenerator<ProviderRuntimeEvent, void, void> {
    const session = this.sessions.begin(context);
    const effectiveMode = this.sessions.effectiveMode(context);
    let bridge: ProviderToolBridgeEntry | null = null;
    const runOptions: CodexRunOptions = {
      cwd: context.cwd,
      sessionId: context.sessionId,
      cliPath: context.cliPath,
      env: context.env,
      model: context.model,
      mode: effectiveMode,
      systemPrompt: context.systemPrompt,
      claudiaSessionId: context.claudiaSessionId,
      bridge,
      engineExecution: context.engineExecution,
      modelConnection: context.modelConnection,
    };

    try {
      bridge = await this.createToolBridge({
        serverPort: context.serverPort,
        sessionId: context.claudiaSessionId,
      });
      runOptions.bridge = bridge;
      // SDK mode runs a session-owned process against the host-provided
      // connection; CLI mode keeps the shared-process pool semantics.
      const turn =
        context.engineExecution?.engineMode === 'sdk' ? runCodexSdkTurn : runCodexAppServer;
      for await (const event of turn(
        input,
        runOptions,
        onPermission ?? (async () => ({ behavior: 'deny' }))
      )) {
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
    await abortCodexSession(sessionId);
  }
}
