import type {
  PermissionCallback,
  PermissionDecision,
  PermissionRequest,
} from '@zclaudia/plugin-sdk/providers';
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk';
import { boundedJsonText, boundedToolInput, truncateUtf8 } from '@zclaudia/agent-common';
import { isDeepStrictEqual } from 'node:util';

/**
 * Bridge between ACP `session/request_permission` and ZClaudia's
 * `PermissionCallback` (design doc §8.2).
 *
 * Hard rules, all probed (§2.6):
 * - Options are matched by `kind`, never by index or array length; extra or
 *   missing options are tolerated.
 * - Host approval maps to `allow_once` only — a one-shot approval must never
 *   escalate to `allow_always`, including in bypass mode (its persistence
 *   scope is unverified).
 * - Denial maps to `reject_once` when offered, otherwise the request is
 *   cancelled — which the agent treats as "not allowed".
 * - Every abnormal path fails CLOSED: callback timeout, callback error,
 *   unparseable payload, missing deny option, or a racing shutdown all deny.
 * - A host decision carrying genuinely modified `updatedInput` cannot be
 *   expressed in ACP's option-only response, so the call is denied. The host
 *   commonly echoes the unchanged input for policy auto-approvals; that is
 *   accepted because it does not change what Cursor will execute.
 *
 * The bridge also records the local decision per `toolCallId` so the event
 * mapper can override the agent's terminal tool status (§9.2): a denied call
 * is reported `completed` by the agent, but must render as an error in
 * ZClaudia.
 */

export const PERMISSION_TIMEOUT_SECONDS = 300;

export type LocalToolDecision = 'allowed' | 'denied' | 'cancelled';

export interface AcpPermissionBridgeOptions {
  /** Supervised mode: every request goes to the host callback. */
  supervised: boolean;
  onPermission: PermissionCallback | undefined;
  /** Invoked when the bridge must deny outside the callback (observability). */
  onAutoDeny?: (toolCallId: string, reason: string) => void;
  /** Test/embedding override; production uses the host-visible 300s timeout. */
  timeoutMs?: number;
}

interface SelectedOutcome {
  response: RequestPermissionResponse;
  allowed: boolean;
}

export class AcpPermissionBridge {
  private readonly decisions = new Map<string, LocalToolDecision>();

  constructor(private readonly options: AcpPermissionBridgeOptions) {}

  decisionFor(toolCallId: string): LocalToolDecision | undefined {
    return this.decisions.get(toolCallId);
  }

  /** Decision recorded without a live request (e.g. plan/ask violation cancel). */
  recordDecision(toolCallId: string, decision: LocalToolDecision): void {
    this.decisions.set(toolCallId, decision);
  }

  async handleRequest(
    request: RequestPermissionRequest,
    signal: AbortSignal
  ): Promise<RequestPermissionResponse> {
    const toolCallId = request.toolCall?.toolCallId ?? '';

    // Bypass mode auto-approves once per call, without touching the callback.
    if (!this.options.supervised) {
      const selected = this.selectOutcome(request, 'allow_once');
      this.decisions.set(toolCallId, selected.allowed ? 'allowed' : 'denied');
      if (!selected.allowed) {
        this.options.onAutoDeny?.(toolCallId, 'permission request offered no allow_once option');
      }
      return selected.response;
    }

    if (!this.options.onPermission) {
      // No callback wired: fail closed.
      this.decisions.set(toolCallId, 'denied');
      this.options.onAutoDeny?.(toolCallId, 'no permission callback registered');
      return this.selectOutcome(request, 'reject_once').response;
    }

    const permissionRequest = this.buildPermissionRequest(request);
    let decision: PermissionDecision;
    try {
      decision = await raceWithAbortAndTimeout(
        this.options.onPermission(permissionRequest),
        signal,
        this.options.timeoutMs ?? PERMISSION_TIMEOUT_SECONDS * 1_000
      );
    } catch (error) {
      // Callback threw or the run aborted: deny, never allow.
      this.decisions.set(toolCallId, signal.aborted ? 'cancelled' : 'denied');
      this.options.onAutoDeny?.(
        toolCallId,
        signal.aborted
          ? 'run aborted during permission request'
          : `permission callback failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return this.selectOutcome(request, 'reject_once').response;
    }
    if (decision === undefined) {
      this.decisions.set(toolCallId, 'denied');
      this.options.onAutoDeny?.(toolCallId, 'permission callback returned no decision');
      return this.selectOutcome(request, 'reject_once').response;
    }

    if (decision.behavior === 'allow') {
      if (
        decision.updatedInput !== undefined &&
        !isDeepStrictEqual(decision.updatedInput, permissionRequest.toolInput)
      ) {
        // ACP cannot carry edited tool input; executing the ORIGINAL input
        // after the host edited it would be a silent trust violation (§8.2).
        this.decisions.set(toolCallId, 'denied');
        this.options.onAutoDeny?.(
          toolCallId,
          'host returned modified tool input, which ACP cannot apply'
        );
        return this.selectOutcome(request, 'reject_once').response;
      }
      const selected = this.selectOutcome(request, 'allow_once');
      this.decisions.set(toolCallId, selected.allowed ? 'allowed' : 'denied');
      if (!selected.allowed) {
        this.options.onAutoDeny?.(toolCallId, 'permission request offered no allow_once option');
      }
      return selected.response;
    }

    this.decisions.set(toolCallId, 'denied');
    return this.selectOutcome(request, 'reject_once').response;
  }

  /** Cancel every pending request bookkeeping when the run aborts. */
  cancelAll(): void {
    // Decisions already recorded stay; unrecorded calls cannot be distinguished
    // reliably post-cancel, and the terminal-status override below treats
    // "unknown after cancel" conservatively via the run-level abort flag.
  }

  private buildPermissionRequest(request: RequestPermissionRequest): PermissionRequest {
    const toolCall: ToolCallUpdate = request.toolCall;
    const toolName =
      (typeof toolCall.name === 'string' && toolCall.name) ||
      (typeof toolCall.title === 'string' && toolCall.title) ||
      toolCall.kind ||
      'unknown-tool';
    const detailParts: string[] = [];
    if (toolCall.title) detailParts.push(`title: ${toolCall.title}`);
    if (toolCall.kind) detailParts.push(`kind: ${toolCall.kind}`);
    if (Array.isArray(toolCall.locations) && toolCall.locations.length > 0) {
      const locations = toolCall.locations
        .slice(0, 8)
        .map(l => l.path)
        .join(', ');
      detailParts.push(`locations: ${locations}`);
    }
    const reasonText = readReasonFromContent(toolCall);
    if (reasonText) detailParts.push(reasonText);
    return {
      requestId: `acp-perm:${toolCall.toolCallId}`,
      toolName,
      toolInput: boundedToolInput(toolCall.rawInput),
      detail: truncateUtf8(detailParts.join(' · ') || 'Cursor agent requested permission', 4_000),
      timeoutSeconds: PERMISSION_TIMEOUT_SECONDS,
      timeoutBehavior: 'deny',
    };
  }

  private selectOutcome(
    request: RequestPermissionRequest,
    preferredKind: 'allow_once' | 'reject_once'
  ): SelectedOutcome {
    const options = Array.isArray(request.options) ? request.options : [];
    const preferred = options.find(option => option.kind === preferredKind);
    if (preferred) {
      return {
        response: { outcome: { outcome: 'selected', optionId: preferred.optionId } },
        allowed: preferredKind === 'allow_once',
      };
    }
    // No semantically matching option: reject/cancel rather than escalating
    // allow_once to allow_always or guessing by array about option order.
    const reject = options.find(
      option => option.kind === 'reject_once' || option.kind === 'reject_always'
    );
    if (reject) {
      return {
        response: { outcome: { outcome: 'selected', optionId: reject.optionId } },
        allowed: false,
      };
    }
    return { response: { outcome: { outcome: 'cancelled' } }, allowed: false };
  }
}

function readReasonFromContent(toolCall: ToolCallUpdate): string | undefined {
  if (!Array.isArray(toolCall.content)) return undefined;
  for (const entry of toolCall.content) {
    if (entry?.type !== 'content') continue;
    const block = (entry as { content?: { type?: unknown; text?: unknown } }).content;
    if (block && block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      return boundedJsonText(block.text, 1_000);
    }
  }
  return undefined;
}

function raceWithAbortAndTimeout<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new Error('aborted'));
  }
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
      () => finishReject(new Error('permission callback timed out')),
      timeoutMs
    );
    timer.unref?.();
    promise.then(
      value => finishResolve(value),
      error => finishReject(error instanceof Error ? error : new Error(String(error)))
    );
  });
}
