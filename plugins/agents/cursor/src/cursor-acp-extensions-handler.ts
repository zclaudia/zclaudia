import {
  boundedJsonText,
  boundedToolInput,
  DEFAULT_TOOL_RESULT_BYTES,
} from '@zclaudia/agent-common';
import type { PermissionCallback, PermissionDecision } from '@zclaudia/plugin-sdk/providers';
import { isDeepStrictEqual } from 'node:util';
import {
  readAskQuestionPayload,
  readCreatePlanPayload,
  readGenerateImagePayload,
  readSubagentTaskPayload,
  readUpdateTodosPayload,
  skippedAskQuestionResponse,
  type CursorCreatePlanOutcome,
  type CursorCreatePlanResponse,
} from './cursor-acp-extensions.js';
import { PERMISSION_TIMEOUT_SECONDS } from './acp-permissions.js';

/**
 * Dispatch for Cursor's private `cursor/*` ACP methods (design doc §10).
 *
 * Every method degrades individually: a schema mismatch or an unsupported
 * request replies with a typed error/skipped outcome and never takes down the
 * standard session (probed baseline: `-32601` replies are survivable).
 * Telemetry-friendly facts only — method names and schema outcomes; payloads
 * (plan bodies, prompts, todo text, image descriptions) are never logged.
 */

export interface CursorAcpExtensionHooks {
  /** ZClaudia permission callback for cursor/create_plan approval (§10.1). */
  onPermission: PermissionCallback | undefined;
  /** Run cancellation also cancels extension permission waits. */
  abortSignal?: AbortSignal;
  /** Display-only todo updates; undefined callback = ignore. */
  onTodoUpdate?: (todos: Array<{ id: string; content: string; status: string }>) => void;
  /** Display-only subagent task notifications (v1: activity only). */
  onSubagentTask?: (description: string | undefined) => void;
  /** Display-only image generation notifications (v1: no media pipeline). */
  onGenerateImage?: (description: string | undefined) => void;
}

export interface CursorExtensionHandlers {
  /** Server → client blocking requests (`cursor/create_plan`, `cursor/ask_question`). */
  request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Server → client notifications (`cursor/update_todos`, `cursor/task`, `cursor/generate_image`). */
  notification(method: string, params: Record<string, unknown>): void;
}

export function createCursorExtensionHandlers(
  hooks: CursorAcpExtensionHooks
): CursorExtensionHandlers {
  return {
    async request(method, params) {
      switch (method) {
        case 'cursor/create_plan':
          return await handleCreatePlan(params, hooks);
        case 'cursor/ask_question':
          // Structured questions need an interaction contract ZClaudia does not
          // have yet (§10.1); a formal skipped outcome beats a -32601 error.
          return (readAskQuestionPayload(params)
            ? skippedAskQuestionResponse(
                'ZClaudia does not support structured questions for this runtime yet.'
              )
            : skippedAskQuestionResponse(
                'Malformed cursor/ask_question payload'
              )) as unknown as Record<string, unknown>;
        default:
          throw { code: -32601, message: `Method not found: ${method}` };
      }
    },
    notification(method, params) {
      switch (method) {
        case 'cursor/update_todos': {
          const payload = readUpdateTodosPayload(params);
          if (payload) hooks.onTodoUpdate?.(payload.todos);
          return;
        }
        case 'cursor/task': {
          const payload = readSubagentTaskPayload(params);
          if (payload) hooks.onSubagentTask?.(payload.description);
          return;
        }
        case 'cursor/generate_image': {
          const payload = readGenerateImagePayload(params);
          if (payload) hooks.onGenerateImage?.(payload.description);
          return;
        }
        default:
          // Unknown extension notification: ignore (§10).
          return;
      }
    },
  };
}

async function handleCreatePlan(
  params: Record<string, unknown>,
  hooks: CursorAcpExtensionHooks
): Promise<Record<string, unknown>> {
  const payload = readCreatePlanPayload(params);
  if (!payload) {
    // Malformed extension payload: reject rather than approve blindly.
    const response: CursorCreatePlanResponse = {
      outcome: {
        outcome: 'rejected',
        reason: 'Malformed cursor/create_plan payload',
      },
    };
    return response as unknown as Record<string, unknown>;
  }

  if (!hooks.onPermission) {
    const response: CursorCreatePlanResponse = {
      outcome: { outcome: 'rejected', reason: 'Plan approval unavailable' },
    };
    return response as unknown as Record<string, unknown>;
  }
  const onPermission = hooks.onPermission;

  const detailParts: string[] = [];
  if (payload.name) detailParts.push(`name: ${payload.name}`);
  if (payload.overview)
    detailParts.push(boundedJsonText(payload.overview, DEFAULT_TOOL_RESULT_BYTES));
  detailParts.push(boundedJsonText(payload.plan, DEFAULT_TOOL_RESULT_BYTES));

  const toolInput = boundedToolInput({
    name: payload.name,
    overview: payload.overview,
    plan: payload.plan,
    todos: payload.todos,
    isProject: payload.isProject,
  });

  const allowed = await (async () => {
    try {
      const decision = await waitForPermission(
        onPermission({
          requestId: `acp-plan:${payload.toolCallId}`,
          toolName: 'createPlan',
          toolInput,
          detail: `Cursor proposes a plan${detailParts.length > 0 ? ` — ${truncateDetail(detailParts.join('\n\n'))}` : ''}`,
          timeoutSeconds: PERMISSION_TIMEOUT_SECONDS,
          timeoutBehavior: 'deny',
        }),
        hooks.abortSignal,
        PERMISSION_TIMEOUT_SECONDS * 1_000
      );
      return (
        decision?.behavior === 'allow' &&
        (decision.updatedInput === undefined || isDeepStrictEqual(decision.updatedInput, toolInput))
      );
    } catch {
      return false; // Fail closed (§8.2).
    }
  })();

  const outcome: CursorCreatePlanOutcome = allowed
    ? { outcome: 'accepted' }
    : { outcome: 'rejected', reason: 'Plan declined in ZClaudia' };
  const response: CursorCreatePlanResponse = { outcome };
  return response as unknown as Record<string, unknown>;
}

function truncateDetail(detail: string): string {
  return detail.length > 4_000 ? `${detail.slice(0, 4_000)}…` : detail;
}

function waitForPermission(
  promise: Promise<PermissionDecision | undefined>,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<PermissionDecision | undefined> {
  if (signal?.aborted) return Promise.reject(new Error('aborted'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const finishResolve = (value: PermissionDecision | undefined) => {
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
    signal?.addEventListener('abort', onAbort, { once: true });
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
