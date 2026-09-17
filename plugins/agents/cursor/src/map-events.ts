import type { ProviderRuntimeEvent } from '@zclaudia/plugin-sdk/providers';
import type { ToolEffect } from '@zclaudia/plugin-sdk/types';
import {
  boundedJsonText,
  boundedToolInput,
  CursorUsageAccumulator,
  DEFAULT_DELTA_BYTES,
  DEFAULT_TOOL_RESULT_BYTES,
  makeModeTransition,
  providerUsageUpdatedEvent,
  truncateUtf8,
} from '@zclaudia/agent-common';
import {
  fileChangeEffectFromInput,
  makeShellEffect,
  readCursorEditResultEffect,
} from './tool-effects.js';

// Tool call key → friendly name mapping
const TOOL_CALL_KEY_MAP: Record<string, string> = {
  editToolCall: 'Edit',
  shellToolCall: 'Bash',
  bashToolCall: 'Bash',
  readToolCall: 'Read',
  searchToolCall: 'Grep',
  lspToolCall: 'LSP',
  mcpToolCall: 'MCP',
  switchModeToolCall: 'switchMode',
  createPlanToolCall: 'createPlan',
};

interface ToolCallInfo {
  toolName: string;
  args: unknown;
  result?: unknown;
  effect?: ToolEffect;
}

export function detectCursorToolSemantic(
  toolName: string,
  args: unknown
): 'plan_enter' | 'plan_exit' | 'plan_proposal' | undefined {
  if (toolName === 'createPlan') return 'plan_proposal';
  if (toolName === 'switchMode') {
    const target = readSwitchModeTarget(args);
    if (target === 'plan') return 'plan_enter';
    if (target) return 'plan_exit';
  }
  return undefined;
}

export function deriveCursorModeTransition(
  toolName: string,
  args: unknown,
  sourceToolUseId: string | undefined
): { mode: string; reason: 'enter' | 'exit'; sourceToolUseId?: string; plan?: string } | undefined {
  if (toolName !== 'switchMode') return undefined;
  const target = readSwitchModeTarget(args);
  if (!target) return undefined;
  return makeModeTransition(target === 'plan' ? 'enter' : 'exit', sourceToolUseId);
}

function readSwitchModeTarget(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const record = args as Record<string, unknown>;
  const candidates = ['targetModeId', 'targetMode', 'mode'];
  for (const key of candidates) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function extractToolCall(toolCallObj: Record<string, unknown>): ToolCallInfo | null {
  for (const key of Object.keys(toolCallObj)) {
    const tc = toolCallObj[key] as { args?: unknown; result?: unknown } | undefined;
    if (!tc) continue;
    const toolName = TOOL_CALL_KEY_MAP[key] || key.replace(/ToolCall$/, '');

    // Extract a human-readable result from nested success/failure structures
    let result = tc.result;
    if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      if (r.success) {
        const s = r.success as Record<string, unknown>;
        // Shell: prefer stdout, fallback to message
        result = s.stdout ?? s.interleavedOutput ?? s.message ?? JSON.stringify(r.success);
      } else if (r.rejected) {
        result = `Rejected: ${(r.rejected as Record<string, unknown>).reason || 'permission denied'}`;
      } else if (r.error) {
        result = String(r.error);
      }
    }

    let effect: ToolEffect | undefined;
    if (toolName === 'Edit') {
      effect = readCursorEditResultEffect(tc.args, tc.result);
    } else if (toolName === 'Bash') {
      const args =
        tc.args && typeof tc.args === 'object' ? (tc.args as Record<string, unknown>) : {};
      effect = makeShellEffect(typeof args.command === 'string' ? args.command : undefined);
    }

    return { toolName, args: tc.args, result, effect };
  }
  return null;
}

export interface MapCursorEventResult {
  events: ProviderRuntimeEvent[];
}

export function mapCursorEvent(event: Record<string, unknown>): MapCursorEventResult {
  const results: ProviderRuntimeEvent[] = [];
  const evType = event.type as string;
  const evSubtype = event.subtype as string | undefined;

  switch (evType) {
    case 'system': {
      if (evSubtype === 'init') {
        const systemInfo = {
          model: event.model as string | undefined,
          cwd: event.cwd as string | undefined,
          apiKeySource: event.apiKeySource as string | undefined,
        };
        results.push({
          type: 'init',
          sessionId: event.session_id as string,
          systemInfo,
        });
      }
      break;
    }

    case 'user':
      // Echo of user input — skip
      break;

    case 'thinking': {
      // cursor-agent already separates reasoning from the answer, so forward it
      // as thinking_delta rather than folding it into the assistant text: a
      // consumer that inlined `<think>` markers would have to parse them back
      // out, and any that failed to would render the tags as literal prose.
      // `completed` needs no event — there is no span left open to close.
      if (evSubtype === 'delta') {
        const text = event.text as string;
        if (text) {
          results.push({
            type: 'thinking_delta',
            thinkingContent: truncateUtf8(text, DEFAULT_DELTA_BYTES),
          });
        }
      }
      break;
    }

    case 'assistant': {
      const message = event.message as
        | {
            content?: Array<{ type: string; text?: string }>;
          }
        | undefined;
      if (message?.content) {
        for (const block of message.content) {
          if (block.type === 'text' && block.text) {
            results.push({
              type: 'assistant',
              content: truncateUtf8(block.text, DEFAULT_DELTA_BYTES),
            });
          }
        }
      }
      break;
    }

    case 'tool_call': {
      const callId = event.call_id as string | undefined;
      const toolCallObj = event.tool_call as Record<string, unknown> | undefined;
      if (!toolCallObj) break;

      const info = extractToolCall(toolCallObj);
      if (!info) break;

      const semantic = detectCursorToolSemantic(info.toolName, info.args);

      if (evSubtype === 'started') {
        results.push({
          type: 'tool_use',
          toolUseId: callId,
          toolName: info.toolName,
          toolInput: boundedToolInput(info.args),
          toolSemantic: semantic,
          toolEffect: info.effect,
        });
      } else if (evSubtype === 'completed') {
        const resultStr = boundedJsonText(
          info.result === undefined || info.result === null ? 'Done' : info.result,
          DEFAULT_TOOL_RESULT_BYTES
        );
        results.push({
          type: 'tool_result',
          toolUseId: callId,
          toolResult: resultStr,
          toolEffect: info.effect,
        });

        // After a successful mode-switching tool completes, normalize to the
        // shared mode_transition event so the runtime stays provider-agnostic.
        const transition = deriveCursorModeTransition(info.toolName, info.args, callId);
        if (transition) {
          results.push({ type: 'mode_transition', modeTransition: transition });
        }
      }
      break;
    }

    case 'result': {
      const rawUsage = event.usage as
        | {
            inputTokens?: number;
            outputTokens?: number;
            cacheReadTokens?: number;
            cacheWriteTokens?: number;
          }
        | undefined;

      if (evSubtype === 'error' || event.is_error) {
        const errMsg = truncateUtf8(
          (event.result as string) || 'cursor-agent returned an error',
          DEFAULT_TOOL_RESULT_BYTES
        );
        results.push({ type: 'error', error: errMsg });
      } else {
        // cursor-agent's four counters are disjoint sums over every LLM call the
        // turn made, not one request: a multi-tool turn reports far more than a
        // single prompt, and `cacheReadTokens` routinely exceeds `inputTokens`.
        // Forward them as-is — they are the honest billing/stats numbers — and
        // deliberately leave `contextUsedTokens` unset, since the final call's
        // window occupancy is not recoverable from a turn aggregate. The host's
        // `estimateContextTokensForThreshold` already discards an anchor larger
        // than the context window and falls back to its structural estimate.
        const input = rawUsage?.inputTokens ?? 0;
        const output = rawUsage?.outputTokens ?? 0;
        const cacheRead = rawUsage?.cacheReadTokens ?? 0;
        const cacheWrite = rawUsage?.cacheWriteTokens ?? 0;
        if (rawUsage) {
          // Usage ledger snapshot (runtime usage design §5.3): the result
          // counters are the turn aggregate; a result without usage fields
          // reports missing through the host's default record state.
          const snapshot = new CursorUsageAccumulator().onResult({
            inputTokens: rawUsage.inputTokens ?? null,
            outputTokens: rawUsage.outputTokens ?? null,
            cacheReadTokens: rawUsage.cacheReadTokens ?? null,
            cacheWriteTokens: rawUsage.cacheWriteTokens ?? null,
            totalTokens: null,
          });
          results.push(providerUsageUpdatedEvent(snapshot));
        }
        results.push({
          type: 'result',
          isComplete: true,
          usage: rawUsage
            ? {
                input,
                output,
                cacheRead,
                cacheWrite,
                totalTokens: input + output + cacheRead + cacheWrite,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              }
            : undefined,
        });
      }
      break;
    }

    default:
    // Unhandled event type — skip silently
  }

  return { events: results };
}
