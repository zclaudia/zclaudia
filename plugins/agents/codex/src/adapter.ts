import type {
  ExternalAgentAdapter,
  ExternalAgentRunContext,
  ExternalAgentRunState,
  PermissionCallback,
  ProviderRuntimeEvent,
  ProviderToolBridgeEntry,
} from '@zclaudia/plugin-sdk/providers';
import type {
  InvocableDescriptor,
  RuntimeInvocationProvider,
  RuntimeTurnInput,
  RuntimeTurnContext,
} from '@zclaudia/plugin-sdk/invocations';
import { InvocationError } from '@zclaudia/plugin-sdk/invocations';
import { AdapterSessionState, type ToolBridgeFactory } from '@zclaudia/agent-common';
import {
  runCodexAppServer,
  runCodexSdkTurn,
  abortCodexSession,
  getOrCreateAppServerClient,
  type CodexRunOptions,
} from './runner.js';
import { createCodexInvocations } from './invocations.js';
import type { AppServerInputBlock } from './app-server-protocol.js';

export type { ToolBridgeFactory } from '@zclaudia/agent-common';

/**
 * URIP runtime invocation support (§14.2, §29 step 5): the Codex plugin
 * publishes its App Server skill catalog and executes structured skill turns.
 * `startTurn` implements the typed turn contract on top of the existing
 * string-run machinery — cancellation, approvals, persistence, and terminal
 * handling stay shared.
 */
export class CodexAgentAdapter implements ExternalAgentAdapter {
  readonly type = 'codex';
  private readonly sessions = new AdapterSessionState({ trackModes: true });
  readonly invocations: RuntimeInvocationProvider;

  constructor(private readonly createToolBridge: ToolBridgeFactory) {
    this.invocations = createCodexInvocations({
      getClient: async () => {
        // Discovery rides the shared pooled CLI client; no bridge config is
        // created for catalog reads.
        return getOrCreateAppServerClient({
          cwd: process.cwd(),
        });
      },
    });
  }

  async *run(
    input: string,
    context: ExternalAgentRunContext,
    onPermission?: PermissionCallback
  ): AsyncGenerator<ProviderRuntimeEvent, void, void> {
    yield* this.runString(input, context, onPermission);
  }

  async *startTurn(
    input: RuntimeTurnInput,
    context: RuntimeTurnContext,
    onPermission?: PermissionCallback
  ): AsyncGenerator<ProviderRuntimeEvent, void, void> {
    switch (input.type) {
      case 'message':
        // Plain text passes through byte-for-byte (§24.4 item 5).
        yield* this.runString(input.text, context, onPermission);
        return;
      case 'runtime-invocation':
        yield* this.runSkillInvocation(
          input.descriptor,
          input.nativeLocator,
          input.arguments,
          context,
          onPermission
        );
        return;
      case 'portable-skill':
        // Host-materialized portable skills are not executable by Codex
        // (§13): fail explicitly BEFORE any provider turn begins.
        throw new InvocationError(
          'PORTABLE_SKILL_UNSUPPORTED',
          'Codex executes only its own skill catalog; this ZClaudia portable skill cannot be handed to it.'
        );
    }
  }

  private async *runString(
    input: string,
    context: ExternalAgentRunContext,
    onPermission?: PermissionCallback
  ): AsyncGenerator<ProviderRuntimeEvent, void, void> {
    const session = this.sessions.begin(context);
    const effectiveMode = this.sessions.effectiveMode(context);
    let bridge: ProviderToolBridgeEntry | null = null;
    const runOptions: CodexRunOptions = this.buildRunOptions(context, effectiveMode);

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

  /**
   * Structured skill turn (§14.2): the adapter constructs the skill input
   * block from the runtime-provided locator (name + path returned by
   * `skills/list`, never supplied by the client) and attaches the raw user
   * arguments as a text block, byte-for-byte.
   */
  private async *runSkillInvocation(
    descriptor: InvocableDescriptor,
    nativeLocator: unknown,
    args: { type: 'raw'; value: string } | { type: 'structured'; value: Record<string, unknown> },
    context: ExternalAgentRunContext,
    onPermission?: PermissionCallback
  ): AsyncGenerator<ProviderRuntimeEvent, void, void> {
    const locator = nativeLocator as { type?: string; name?: unknown; path?: unknown };
    if (
      !locator ||
      locator.type !== 'skill' ||
      typeof locator.name !== 'string' ||
      typeof locator.path !== 'string'
    ) {
      throw new InvocationError(
        'INVOCATION_PROTOCOL_MISMATCH',
        'The selected skill reference is stale; refresh the catalog and select it again.'
      );
    }
    // Raw arguments pass through verbatim; structured arguments are rejected —
    // this adapter declared raw-only in its argument contract.
    if (args.type !== 'raw') {
      throw new InvocationError(
        'INVOCATION_ARGUMENTS_INVALID',
        'Codex skills accept freeform text arguments only.'
      );
    }
    const skillBlock: AppServerInputBlock = {
      type: 'skill',
      name: locator.name,
      path: locator.path,
    };
    const argsBlock: AppServerInputBlock | undefined = args.value
      ? { type: 'text', text: args.value, text_elements: [] }
      : undefined;
    const inputBlocks: AppServerInputBlock[] = argsBlock ? [skillBlock, argsBlock] : [skillBlock];

    const session = this.sessions.begin(context);
    const effectiveMode = this.sessions.effectiveMode(context);
    let bridge: ProviderToolBridgeEntry | null = null;
    const runOptions: CodexRunOptions = {
      ...this.buildRunOptions(context, effectiveMode),
      inputBlocks,
    };

    try {
      bridge = await this.createToolBridge({
        serverPort: context.serverPort,
        sessionId: context.claudiaSessionId,
      });
      runOptions.bridge = bridge;
      const turn =
        context.engineExecution?.engineMode === 'sdk' ? runCodexSdkTurn : runCodexAppServer;
      for await (const event of turn(
        args.value,
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

  private buildRunOptions(
    context: ExternalAgentRunContext,
    effectiveMode: string | undefined
  ): CodexRunOptions {
    return {
      cwd: context.cwd,
      sessionId: context.sessionId,
      cliPath: context.cliPath,
      env: context.env,
      model: context.model,
      mode: effectiveMode,
      systemPrompt: context.systemPrompt,
      claudiaSessionId: context.claudiaSessionId,
      bridge: null,
      engineExecution: context.engineExecution,
      modelConnection: context.modelConnection,
    };
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
