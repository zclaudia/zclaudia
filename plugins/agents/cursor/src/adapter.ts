import type {
  ExternalAgentAdapter,
  ExternalAgentRunContext,
  ExternalAgentRunState,
  PermissionCallback,
  ProviderRuntimeEvent,
} from '@zclaudia/plugin-sdk/providers';
import type { RuntimeInvocationProvider, RuntimeTurnInput } from '@zclaudia/plugin-sdk/invocations';
import { InvocationError } from '@zclaudia/plugin-sdk/invocations';
import { AdapterSessionState, type ToolBridgeFactory } from '@zclaudia/agent-common';
import { runCursor, abortCursorSession, type CursorMode } from './runner.js';
import { runCursorAcp, CURSOR_ACP_TRANSPORT } from './acp-runner.js';
import { createCursorInvocations } from './invocations.js';
import { CursorAcpError } from './errors.js';

export type { ToolBridgeFactory } from '@zclaudia/agent-common';

export const CURSOR_STREAM_JSON_TRANSPORT = 'cursor-stream-json-v1';

/**
 * Internal gray-release transport gate (design doc §15 / P4). Never user
 * facing, never part of profile config:
 *
 * - `unset`/`auto`/`acp`: new sessions run ACP. Handshake/auth/startup failures FAIL; there
 *   is no automatic fallback to legacy, ever (§1.6).
 * - `stream-json`: new sessions explicitly use the legacy driver during the
 *   rollback window. Existing sessions always follow their persisted transport.
 *
 * A session with a persisted `providerTransport` is bound: resumes never
 * switch transports, whatever the environment says.
 */
function resolveNewSessionTransport(
  env: Record<string, string> | undefined
): typeof CURSOR_ACP_TRANSPORT | typeof CURSOR_STREAM_JSON_TRANSPORT {
  const value = (env?.ZCLAUDIA_CURSOR_TRANSPORT ?? process.env.ZCLAUDIA_CURSOR_TRANSPORT ?? '')
    .trim()
    .toLowerCase();
  if (value === 'stream-json') return CURSOR_STREAM_JSON_TRANSPORT;
  if (!value || value === 'auto' || value === 'acp') return CURSOR_ACP_TRANSPORT;
  throw new CursorAcpError(
    'CURSOR_ACP_PROTOCOL_ERROR',
    `Unsupported ZCLAUDIA_CURSOR_TRANSPORT value: ${value}. Expected auto, acp, or stream-json.`
  );
}

export class CursorAgentAdapter implements ExternalAgentAdapter {
  readonly type = 'cursor';
  private readonly sessions = new AdapterSessionState({ trackModes: true });
  constructor(private readonly createToolBridge: ToolBridgeFactory) {}

  readonly invocations: RuntimeInvocationProvider = createCursorInvocations({
    newClient: async (cwd, signal) => {
      // Discovery opens a real short-lived ACP session via the production
      // client; the tests inject a fake here.
      const { AcpClient } = await import('./acp-client.js');
      const { AcpPermissionBridge } = await import('./acp-permissions.js');
      const client = new AcpClient();
      try {
        await client.connect({
          cwd,
          bridge: null,
          permissionBridge: new AcpPermissionBridge({ supervised: true, onPermission: undefined }),
          extensionHooks: { onPermission: undefined },
          abortSignal: signal,
        });
      } catch (error) {
        await client.close();
        throw error;
      }
      let sink:
        | ((update: {
            sessionUpdate: string;
            availableCommands?: Array<{ name: string; description?: string }>;
          }) => void)
        | undefined;
      client.onUpdate = update => {
        if (update.sessionUpdate === 'available_commands_update') {
          sink?.(
            update as unknown as {
              sessionUpdate: string;
              availableCommands?: Array<{ name: string; description?: string }>;
            }
          );
        }
      };
      return {
        onUpdate: cb => {
          sink = cb;
        },
        newSession: async sessionCwd => {
          await client.agent.newSession({ cwd: sessionCwd, mcpServers: [] });
        },
        close: () => client.close(),
      };
    },
  });

  async *startTurn(
    input: RuntimeTurnInput,
    context: ExternalAgentRunContext,
    onPermission?: PermissionCallback
  ): AsyncGenerator<ProviderRuntimeEvent, void, void> {
    switch (input.type) {
      case 'message':
        yield* this.run(input.text, context, onPermission);
        return;
      case 'runtime-invocation': {
        // Emulated execution (§14.3): the advertised command syntax is
        // compiled into the ACP prompt, labeled best-effort.
        if (input.arguments.type !== 'raw') {
          throw new InvocationError(
            'INVOCATION_ARGUMENTS_INVALID',
            'Cursor commands accept freeform text arguments only.'
          );
        }
        const text = input.arguments.value
          ? `${input.descriptor.displayTrigger} ${input.arguments.value}`
          : input.descriptor.displayTrigger;
        yield* this.run(text, context, onPermission);
        return;
      }
      case 'portable-skill': {
        if (input.skill.resources) {
          throw new InvocationError(
            'PORTABLE_SKILL_RESOURCE_UNAVAILABLE',
            'Emulated Cursor execution cannot provide skill resource files.'
          );
        }
        const compiled =
          input.arguments.type === 'raw' && input.arguments.value
            ? `${input.skill.body}\n\n${input.arguments.value}`
            : input.skill.body;
        yield* this.run(compiled, context, onPermission);
        return;
      }
    }
  }

  async *run(
    input: string,
    context: ExternalAgentRunContext,
    onPermission?: PermissionCallback
  ): AsyncGenerator<ProviderRuntimeEvent, void, void> {
    const session = this.sessions.begin(context);
    const effectiveMode = this.sessions.effectiveMode(context);

    try {
      const bridge = await this.createToolBridge({
        serverPort: context.serverPort,
        sessionId: context.claudiaSessionId,
      });

      // Transport binding: resumed sessions obey their persisted transport;
      // unbound sessions follow the internal release gate (§15).
      const isResume = Boolean(context.sessionId);
      const transport =
        context.providerTransport ??
        (isResume ? CURSOR_STREAM_JSON_TRANSPORT : resolveNewSessionTransport(context.env));

      let runEvents: AsyncGenerator<ProviderRuntimeEvent, void, void>;
      switch (transport) {
        case CURSOR_ACP_TRANSPORT:
          runEvents = runCursorAcp(input, {
            cwd: context.cwd,
            sessionId: context.sessionId,
            cliPath: context.cliPath,
            env: context.env,
            model: context.model,
            mode: effectiveMode,
            systemPrompt: context.systemPrompt,
            abortController: session.abortController,
            bridge,
            onPermission: onPermission ?? undefined,
            providerTransport: context.providerTransport ?? null,
          });
          break;
        case CURSOR_STREAM_JSON_TRANSPORT:
          runEvents = runCursor(input, {
            cwd: context.cwd,
            sessionId: context.sessionId,
            cliPath: context.cliPath,
            env: context.env,
            model: context.model,
            mode: effectiveMode as CursorMode | undefined,
            systemPrompt: context.systemPrompt,
            serverPort: context.serverPort,
            claudiaSessionId: context.claudiaSessionId,
            abortController: session.abortController,
            bridge,
            onSessionId: id => {
              this.sessions.registerProviderSession(session, id);
            },
          });
          break;
        default:
          throw new CursorAcpError(
            'CURSOR_ACP_PROTOCOL_ERROR',
            `Unsupported persisted Cursor transport: ${transport}. Start a new session or repair the session transport binding.`
          );
      }

      for await (const event of runEvents) {
        // The ACP runner stamps its own transport on init; the legacy runner
        // never declares ACP, so bind it here (§14.3 — explicit legacy sessions
        // go through the same persistence path).
        const normalized =
          event.type === 'init' && !event.providerTransport
            ? { ...event, providerTransport: CURSOR_STREAM_JSON_TRANSPORT }
            : event;
        this.sessions.observe(session, normalized);
        yield normalized;
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
