import type {
  ExternalAgentRunContext,
  PermissionCallback,
  ProviderRuntimeEvent,
  ProviderToolBridgeEntry,
} from '@zclaudia/plugin-sdk/providers';
import type { SessionUpdate, StopReason } from '@agentclientprotocol/sdk';
import { CursorUsageAccumulator, providerUsageUpdatedEvent } from '@zclaudia/agent-common';
import { AcpClient, jsonRpcErrorToAcpError } from './acp-client.js';
import { AcpEventMapper } from './acp-events.js';
import { AcpPermissionBridge } from './acp-permissions.js';
import { resolveAcpModelId, resolveAcpModeId } from './acp-models.js';
import { mapBridgeToAcpMcpServers } from './acp-mcp.js';
import { readSessionModels } from './cursor-acp-extensions.js';
import { CursorAcpError } from './errors.js';

/**
 * Single-run ACP state machine (design doc §7):
 *
 *   resolving_cli → spawning → initializing → authenticating →
 *   creating_or_loading_session → setting_mode_and_model → prompting →
 *   draining_updates → closing
 *
 * States only move forward. Two boundaries drive error semantics:
 * - `promptSubmitted`: after this, errors are provider errors with side
 *   effects; no transport retry may ever re-send the prompt (§1.6, §14).
 * - the settled prompt response is mapped to exactly one terminal event (§7.5).
 *
 * The generator yields the `init` event after `session/new` / `session/load`
 * and BEFORE `session/prompt`. The host persists provider session id +
 * transport synchronously when it consumes that event (§14.3); this generator
 * only resumes — and only then submits the prompt — when the host asks for the
 * next event, so a persistence failure closes the iterator without a prompt.
 */

export const CURSOR_ACP_TRANSPORT = 'cursor-acp-v1';
const ACP_REQUEST_TIMEOUT_MS = 30_000;
const CANCEL_GRACE_MS = 1_000;

export interface CursorAcpRunOptions {
  cwd: string;
  sessionId?: string;
  cliPath?: string;
  env?: Record<string, string>;
  model?: string;
  mode?: string;
  systemPrompt?: string;
  abortController?: AbortController;
  bridge: ProviderToolBridgeEntry | null | undefined;
  onPermission: PermissionCallback | undefined;
  /** Persisted transport of the provider session being resumed, if any. */
  providerTransport?: string | null;
}

interface AcpPromptResponse {
  stopReason: StopReason;
  usage?: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    cachedReadTokens?: number | null;
    cachedWriteTokens?: number | null;
    totalTokens?: number | null;
  } | null;
}

export async function* runCursorAcp(
  input: string,
  options: CursorAcpRunOptions
): AsyncGenerator<ProviderRuntimeEvent, void, void> {
  const supervised = options.mode !== 'bypassPermissions';
  const permissionBridge = new AcpPermissionBridge({
    supervised,
    onPermission: options.onPermission,
  });

  const client = new AcpClient();
  const abortController = options.abortController ?? new AbortController();

  const pendingEvents: ProviderRuntimeEvent[] = [];
  const waiters: Array<() => void> = [];
  let violation: CursorAcpError | undefined;
  let settled:
    | { ok: true; response: AcpPromptResponse }
    | { ok: false; error: unknown }
    | undefined;
  let promptSubmitted = false;
  let promptAborted = false;
  let abortGraceExpired = false;
  let abortGraceTimer: NodeJS.Timeout | undefined;
  let activeSessionId: string | undefined;

  const mapper = new AcpEventMapper({
    zclaudiaMode: options.mode,
    decisionFor: id => permissionBridge.decisionFor(id),
    onMutatingToolViolation: (toolCallId, kind, title) => {
      // Second line of defense for plan/ask (§8.3): cancel the run and report
      // the protocol violation. Detection can lag execution; this is not a
      // security boundary, and the manifest keeps permission.mode best-effort.
      permissionBridge.recordDecision(toolCallId, 'cancelled');
      violation = new CursorAcpError(
        'CURSOR_PERMISSION_PROTOCOL_ERROR',
        `A workspace-mutating tool (${kind ?? 'unknown'}${title ? `: ${title}` : ''}) started executing in ${options.mode} mode without permission; cancelling the turn.`
      );
      wake();
      void cancelPrompt();
    },
  });

  client.onUpdate = (update: SessionUpdate) => {
    for (const event of mapper.applyUpdate(update)) {
      pendingEvents.push(event);
    }
    wake();
  };

  function wake(): void {
    for (const resolve of waiters.splice(0)) resolve();
  }

  async function cancelPrompt(): Promise<void> {
    if (!promptSubmitted || !activeSessionId) return;
    try {
      await client.agent.cancel({ sessionId: activeSessionId });
    } catch {
      // Connection may already be closing; the close ladder converges below.
    }
  }

  const onAbort = (): void => {
    promptAborted = true;
    if (promptSubmitted && !abortGraceTimer) {
      abortGraceTimer = setTimeout(() => {
        abortGraceExpired = true;
        wake();
      }, CANCEL_GRACE_MS);
      abortGraceTimer.unref?.();
    }
    wake();
    void cancelPrompt();
  };
  abortController.signal.addEventListener('abort', onAbort, { once: true });

  try {
    if (abortController.signal.aborted) return;

    // Refuse mismatched transport bindings before spawning anything (§14.4):
    // a legacy-bound session is never guessed into ACP, and no round-trip is
    // wasted on a handshake that cannot lead to a prompt.
    if (
      options.sessionId &&
      options.providerTransport &&
      options.providerTransport !== CURSOR_ACP_TRANSPORT
    ) {
      throw new CursorAcpError(
        'CURSOR_SESSION_NOT_FOUND',
        'This session was created with the legacy Cursor transport and cannot be resumed over ACP. Continue it with the legacy transport or start a new session.'
      );
    }

    // ── spawning → initializing → authenticating ──
    await client.connect({
      cwd: options.cwd,
      cliPath: options.cliPath,
      env: options.env,
      bridge: options.bridge,
      permissionBridge,
      extensionHooks: {
        onPermission: options.onPermission,
        abortSignal: abortController.signal,
        onTodoUpdate: () => {}, // Display-only in v1; no host contract yet (§10.1).
        onSubagentTask: () => {},
        onGenerateImage: () => {},
      },
      abortSignal: abortController.signal,
    });

    // ── creating_or_loading_session (§7.3) ──
    const mappedBridge = mapBridgeToAcpMcpServers(options.bridge ?? undefined);
    let sessionResponse: Record<string, unknown>;
    if (options.sessionId && options.providerTransport === CURSOR_ACP_TRANSPORT) {
      if (!client.initializeResult?.loadSession) {
        throw new CursorAcpError(
          'CURSOR_ACP_UNSUPPORTED',
          'Agent does not advertise loadSession; cannot resume this session over ACP.'
        );
      }
      mapper.replaying = true;
      try {
        sessionResponse = (await waitForAcpRequest(
          client.agent.loadSession({
            sessionId: options.sessionId,
            cwd: options.cwd,
            mcpServers: mappedBridge,
          }),
          abortController.signal,
          'session/load'
        )) as unknown as Record<string, unknown>;
      } catch (error) {
        // Load failure never silently becomes session/new (§7.3): the user
        // decides to start a fresh session instead.
        throw jsonRpcErrorToAcpError('session/load', error);
      } finally {
        mapper.replaying = false;
      }
      activeSessionId = options.sessionId;
    } else {
      try {
        sessionResponse = (await waitForAcpRequest(
          client.agent.newSession({
            cwd: options.cwd,
            mcpServers: mappedBridge,
          }),
          abortController.signal,
          'session/new'
        )) as unknown as Record<string, unknown>;
      } catch (error) {
        throw jsonRpcErrorToAcpError('session/new', error);
      }
      activeSessionId =
        typeof sessionResponse.sessionId === 'string' ? sessionResponse.sessionId : undefined;
    }
    if (!activeSessionId) {
      throw new CursorAcpError('CURSOR_ACP_PROTOCOL_ERROR', 'Agent returned no session id.');
    }

    // ── setting_mode_and_model (§7.4, §8.1) ──
    const models = readSessionModels(sessionResponse);
    const modesState = readModesState(sessionResponse);
    const modeResolution = resolveAcpModeId(
      modesState?.availableModes,
      modesState?.currentModeId,
      options.mode
    );
    if (modeResolution.modeId) {
      try {
        await waitForAcpRequest(
          client.agent.setSessionMode({
            sessionId: activeSessionId,
            modeId: modeResolution.modeId,
          }),
          abortController.signal,
          'session/set_mode'
        );
      } catch (error) {
        throw jsonRpcErrorToAcpError('session/set_mode', error);
      }
    }
    const modelResolution = resolveAcpModelId(models, options.model);
    if (modelResolution.modelId) {
      try {
        // `session/set_model` is a Cursor extension on the ACP v1 wire
        // (probed §2.3; SDK 1.4.0 does not type it), so it goes out as a
        // plain request with the documented params.
        await waitForAcpRequest(
          (
            client.agent as unknown as {
              request: (method: string, params: unknown) => Promise<unknown>;
            }
          ).request('session/set_model', {
            sessionId: activeSessionId,
            modelId: modelResolution.modelId,
          }),
          abortController.signal,
          'session/set_model'
        );
      } catch (error) {
        throw jsonRpcErrorToAcpError('session/set_model', error);
      }
    }

    // ── init yield: the run suspends here until the host persists (§14.3) ──
    yield {
      type: 'init',
      sessionId: activeSessionId,
      providerTransport: CURSOR_ACP_TRANSPORT,
      systemInfo: mapper.buildSystemInfo({
        models,
        effectiveModelId: modelResolution.modelId ?? models?.currentModelId,
        displayName:
          modelResolution.displayName ??
          models?.availableModels.find(m => m.modelId === models.currentModelId)?.name,
        cwd: options.cwd,
        permissionMode: supervised ? options.mode : 'bypassPermissions',
      }),
    };

    if (abortController.signal.aborted) return;

    // ── prompting: one-shot; failures are provider errors, never transport
    // retries (§1.6) ──
    promptSubmitted = true;
    const promptText = options.systemPrompt
      ? `[System Context]\n${options.systemPrompt}\n\n${input}`
      : input;
    client.agent
      .prompt({
        sessionId: activeSessionId,
        prompt: [{ type: 'text', text: promptText }],
      })
      .then(
        response => {
          settled = { ok: true, response: response as unknown as AcpPromptResponse };
          wake();
        },
        error => {
          settled = { ok: false, error: jsonRpcErrorToAcpError('session/prompt', error) };
          wake();
        }
      );

    // ── draining_updates: flush mapped events until the prompt settles ──
    // The settled/violation flags are re-checked after every yield: wake() may
    // fire while the consumer is processing an event, before a waiter exists.
    while (!settled && !violation && !abortGraceExpired) {
      while (pendingEvents.length > 0) {
        const event = pendingEvents.shift();
        if (event) yield event;
        if (settled || violation || abortGraceExpired) break;
      }
      if (settled || violation || abortGraceExpired) break;
      await new Promise<void>(resolve => {
        waiters.push(resolve);
      });
    }
    while (pendingEvents.length > 0) {
      const event = pendingEvents.shift();
      if (event) yield event;
    }

    if (violation) throw violation;
    if (promptAborted && !settled) return;
    if (!settled)
      throw new CursorAcpError('CURSOR_ACP_PROTOCOL_ERROR', 'Prompt ended without a response.');
    if (!settled.ok) throw settled.error;
    const response = settled.response;

    // ── closing: exactly one terminal event from the stop reason (§7.5) ──
    if (abortController.signal.aborted || promptAborted) {
      // Local abort: converge quietly like the legacy runner.
      return;
    }
    // Usage ledger snapshot (runtime usage design §5.3): emitted only when
    // the prompt response carries usage — its presence is unverified for
    // this CLI, so absence reports missing via the host's default record
    // state. `usage_update` mid-turn events stay ignored: their protocol
    // meaning (context occupancy vs consumption) is unverified and they are
    // never counted as consumed tokens.
    if (response.usage) {
      yield providerUsageUpdatedEvent(
        new CursorUsageAccumulator().onResult({
          inputTokens: response.usage.inputTokens ?? null,
          outputTokens: response.usage.outputTokens ?? null,
          cacheReadTokens: response.usage.cachedReadTokens ?? null,
          cacheWriteTokens: response.usage.cachedWriteTokens ?? null,
          totalTokens: response.usage.totalTokens ?? null,
        })
      );
    }
    yield terminalFromStopReason(response);
  } catch (error) {
    if (abortController.signal.aborted && !promptSubmitted) return;
    const acpError =
      error instanceof CursorAcpError
        ? error
        : new CursorAcpError(
            'CURSOR_ACP_PROTOCOL_ERROR',
            error instanceof Error ? error.message : String(error)
          );
    yield { type: 'error', error: acpError.message, errorCode: acpError.code };
  } finally {
    if (abortGraceTimer) clearTimeout(abortGraceTimer);
    abortController.signal.removeEventListener('abort', onAbort);
    client.onUpdate = undefined;
    await client.close();
  }
}

/** Map the ACP stop reason to the single terminal event (§7.5). */
function terminalFromStopReason(response: AcpPromptResponse): ProviderRuntimeEvent {
  const usage = readUsage(response.usage);
  switch (response.stopReason) {
    case 'end_turn':
      return { type: 'provider_turn_finished', isComplete: true, ...(usage ? { usage } : {}) };
    case 'cancelled':
      // Agent-side cancellation without a local abort: report, don't pretend.
      return {
        type: 'error',
        error: 'The Cursor agent cancelled the turn.',
        errorCode: 'CURSOR_ACP_PROTOCOL_ERROR',
      };
    case 'max_tokens':
      return {
        type: 'provider_turn_finished',
        isComplete: true,
        error: 'The model reached its output limit for this turn; retry to continue.',
        ...(usage ? { usage } : {}),
      };
    case 'max_turn_requests':
      return {
        type: 'provider_turn_finished',
        isComplete: true,
        error: 'The agent reached its request limit for this turn.',
        ...(usage ? { usage } : {}),
      };
    case 'refusal':
      return {
        type: 'error',
        error: 'The Cursor agent refused this request.',
        errorCode: 'CURSOR_ACP_PROTOCOL_ERROR',
      };
    default:
      return {
        type: 'error',
        error: `The Cursor agent ended the turn with an unrecognized stop reason: ${String(response.stopReason)}`,
        errorCode: 'CURSOR_ACP_PROTOCOL_ERROR',
      };
  }
}

function readUsage(usage: AcpPromptResponse['usage']): ProviderRuntimeEvent['usage'] | undefined {
  if (!usage) return undefined;
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cacheRead = usage.cachedReadTokens ?? 0;
  const cacheWrite = usage.cachedWriteTokens ?? 0;
  const totalTokens = usage.totalTokens ?? input + output + cacheRead + cacheWrite;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/** Runtime guard for the standard `modes` field on session responses. */
function readModesState(
  response: Record<string, unknown>
): { currentModeId: string; availableModes: Array<{ id: string; name: string }> } | undefined {
  const modes = response.modes;
  if (!modes || typeof modes !== 'object') return undefined;
  const record = modes as { currentModeId?: unknown; availableModes?: unknown };
  if (typeof record.currentModeId !== 'string' || !Array.isArray(record.availableModes))
    return undefined;
  const availableModes: Array<{ id: string; name: string }> = [];
  for (const entry of record.availableModes) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, name } = entry as { id?: unknown; name?: unknown };
    if (typeof id === 'string' && typeof name === 'string') availableModes.push({ id, name });
  }
  return { currentModeId: record.currentModeId, availableModes };
}

function waitForAcpRequest<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  method: string
): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('aborted'));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    const finishResolve = (value: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => finishReject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(
      () =>
        finishReject(
          new CursorAcpError(
            'CURSOR_ACP_PROTOCOL_ERROR',
            `Timed out waiting for ${method} response.`
          )
        ),
      ACP_REQUEST_TIMEOUT_MS
    );
    timer.unref?.();
    promise.then(
      value => finishResolve(value),
      error => finishReject(error instanceof Error ? error : new Error(String(error)))
    );
  });
}

/** Re-export for the adapter's transport selection. */
export type { ExternalAgentRunContext };
