import { runBash } from './bash-runner.js';
import { parseToolRule } from '@zclaudia/shared/interaction/tool-rule-syntax';
import {
  matchesToolRule,
  clampHookTimeout,
  type UserHookDefinition,
  type UserHookEvent,
} from '@zclaudia/shared/interaction/user-hooks';

export interface HookInvocation {
  event: UserHookEvent;
  toolName: string;
  toolInput: unknown;
  /**
   * PostToolUse only: the raw tool result. Sent to the hook as `toolResponse`
   * on stdin after sanitizeHookToolResult caps it.
   */
  toolResult?: unknown;
  detail: string;
  cwd: string;
  sessionId?: string;
}

export interface PreHookOutcome {
  blocked: boolean;
  reason?: string;
}

const REASON_LIMIT = 1024;
/** Per-text-block cap for the tool result forwarded to PostToolUse hooks. */
export const HOOK_TOOL_RESULT_TEXT_LIMIT = 8 * 1024;

/**
 * Claude Code's `tool_response` equivalent for PostToolUse hooks. A full Bash
 * spill or Read dump would swamp the hook's stdin payload, so oversized text
 * blocks are capped (the marker notes the cut) and image/binary blocks degrade
 * to a placeholder — no base64 megabytes cross the process boundary.
 */
export function sanitizeHookToolResult(result: unknown): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const record = result as { content?: unknown };
  if (!Array.isArray(record.content)) return result;
  const content = record.content.map(block => {
    if (!block || typeof block !== 'object') return block;
    const b = block as { type?: unknown; text?: unknown };
    if (b.type === 'text' && typeof b.text === 'string') {
      if (b.text.length <= HOOK_TOOL_RESULT_TEXT_LIMIT) return block;
      return {
        ...b,
        text:
          b.text.slice(0, HOOK_TOOL_RESULT_TEXT_LIMIT) +
          `\n... [truncated ${b.text.length - HOOK_TOOL_RESULT_TEXT_LIMIT} chars for hook payload]`,
      };
    }
    if (b.type === 'image') {
      return { type: 'text', text: '[image content omitted from hook payload]' };
    }
    return block;
  });
  return { ...record, content };
}

function matchingHooks(
  hooks: UserHookDefinition[],
  event: UserHookEvent,
  toolName: string,
  detail: string
): UserHookDefinition[] {
  return hooks.filter(h => {
    if (h.event !== event || h.enabled === false) return false;
    if (!h.matcher) return true;
    const parsed = parseToolRule(h.matcher);
    if (!parsed.ok) {
      console.warn(
        `[UserHooks] skipping hook with invalid matcher "${h.matcher}": ${parsed.error}`
      );
      return false;
    }
    return matchesToolRule(parsed.rule, toolName, detail);
  });
}

async function invokeHook(hook: UserHookDefinition, inv: HookInvocation, signal?: AbortSignal) {
  return runBash({
    command: hook.command,
    cwd: inv.cwd,
    timeoutSec: Math.ceil(clampHookTimeout(hook.timeoutMs) / 1000),
    signal,
    stdin: JSON.stringify({
      event: inv.event,
      toolName: inv.toolName,
      toolInput: inv.toolInput,
      // undefined for PreToolUse — JSON.stringify drops the key there.
      toolResponse:
        inv.toolResult === undefined ? undefined : sanitizeHookToolResult(inv.toolResult),
      detail: inv.detail,
      cwd: inv.cwd,
      sessionId: inv.sessionId,
    }),
    extraEnv: { ZCLAUDIA_HOOK_EVENT: inv.event, ZCLAUDIA_TOOL_NAME: inv.toolName },
  });
}

/**
 * Run PreToolUse hooks sequentially (config order). Exit 2 blocks the tool
 * call with stderr (≤1KB) as the model-visible reason; any other failure mode
 * (nonzero exit, timeout, abort, spawn error) warns and passes — a broken
 * hook must never wedge a run.
 */
export async function runPreToolUseHooks(
  hooks: UserHookDefinition[],
  inv: HookInvocation,
  signal?: AbortSignal
): Promise<PreHookOutcome> {
  for (const hook of matchingHooks(hooks, 'PreToolUse', inv.toolName, inv.detail)) {
    try {
      const result = await invokeHook(hook, inv, signal);
      if (result.timedOut || result.aborted) {
        console.warn(
          `[UserHooks] PreToolUse hook timed out/aborted, passing: ${hook.command.slice(0, 80)}`
        );
        continue;
      }
      if (result.exitCode === 2) {
        const reason =
          result.stderrOutput.trim().slice(0, REASON_LIMIT) ||
          `Blocked by PreToolUse hook: ${hook.command.slice(0, 80)}`;
        return { blocked: true, reason };
      }
      if (result.exitCode !== 0) {
        console.warn(
          `[UserHooks] PreToolUse hook exited ${result.exitCode}, passing: ${hook.command.slice(0, 80)}`
        );
      }
    } catch (err) {
      console.warn('[UserHooks] PreToolUse hook failed, passing:', err);
    }
  }
  return { blocked: false };
}

/**
 * Run PostToolUse hooks sequentially. Exit 2's stderr (≤1KB) is collected as
 * extra context appended to the tool result; everything else only logs.
 */
export async function runPostToolUseHooks(
  hooks: UserHookDefinition[],
  inv: HookInvocation,
  signal?: AbortSignal
): Promise<string[]> {
  const extras: string[] = [];
  for (const hook of matchingHooks(hooks, 'PostToolUse', inv.toolName, inv.detail)) {
    try {
      const result = await invokeHook(hook, inv, signal);
      if (result.timedOut || result.aborted) {
        console.warn(
          `[UserHooks] PostToolUse hook timed out/aborted: ${hook.command.slice(0, 80)}`
        );
        continue;
      }
      if (result.exitCode === 2) {
        const text = result.stderrOutput.trim().slice(0, REASON_LIMIT);
        if (text) extras.push(text);
      } else if (result.exitCode !== 0) {
        console.warn(
          `[UserHooks] PostToolUse hook exited ${result.exitCode}: ${hook.command.slice(0, 80)}`
        );
      }
    } catch (err) {
      console.warn('[UserHooks] PostToolUse hook failed:', err);
    }
  }
  return extras;
}
