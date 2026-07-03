import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { ProviderRuntimeEvent } from '../message-types.js';

export interface TranslateToolContext {
  sessionId: string;
  model: string;
  cwd: string;
}

interface PiToolCallBlock {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

function toolInteractionKind(toolName: string): 'todo_update' | undefined {
  const normalized = toolName.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return normalized === 'todowrite' ||
    normalized === 'updatetodos' ||
    normalized === 'todolist' ||
    normalized === 'todolistwrite'
    ? 'todo_update'
    : undefined;
}

/**
 * The pi adapter is the only place that knows its plan-mode tool names, so it
 * tags a successful EnterPlanMode/ExitPlanMode completion with a mode_transition
 * event. That drives the downstream mode.changed → mode_change pipeline so the
 * client's mode selector follows AI-initiated plan-mode switches. A failed
 * toggle (rejected plan, missing context → details.ok === false) emits nothing,
 * so a rejection never flips the UI mode.
 */
function planModeTransitionEvent(
  toolName: unknown,
  toolUseId: string | undefined,
  result: unknown
): ProviderRuntimeEvent | undefined {
  if (typeof toolName !== 'string') return undefined;
  const normalized = toolName.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (normalized !== 'enterplanmode' && normalized !== 'exitplanmode') return undefined;
  const ok = (result as { details?: { ok?: unknown } } | null | undefined)?.details?.ok;
  if (ok === false) return undefined;
  const entering = normalized === 'enterplanmode';
  return {
    type: 'mode_transition',
    modeTransition: {
      mode: entering ? 'plan' : 'default',
      reason: entering ? 'enter' : 'exit',
      sourceToolUseId: toolUseId,
    },
  };
}

function isToolCallBlock(block: unknown): block is PiToolCallBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'toolCall' &&
    typeof (block as { id?: unknown }).id === 'string' &&
    typeof (block as { name?: unknown }).name === 'string'
  );
}

function extractPartialText(partialResult: unknown): string {
  if (!partialResult || typeof partialResult !== 'object') return '';
  const content = (partialResult as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (b: unknown) =>
        typeof b === 'object' && b !== null && (b as { type?: unknown }).type === 'text'
    )
    .map((b: unknown) => String((b as { text?: unknown }).text ?? ''))
    .join('');
}

/**
 * Translate pi tool-related AgentEvents into ZClaudia ProviderRuntimeEvent(s).
 * Returns:
 *  - undefined — event ignored
 *  - ProviderRuntimeEvent — one event to push
 *  - ProviderRuntimeEvent[] — multiple to push (e.g. assistant with N toolCalls)
 */
export function translateToolEvent(
  event: AgentEvent,
  _ctx: TranslateToolContext
): ProviderRuntimeEvent | ProviderRuntimeEvent[] | undefined {
  try {
    switch (event.type) {
      case 'message_end': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const msg = (event as any).message;
        if (!msg || msg.role !== 'assistant') return undefined;
        const content = msg.content;
        if (!Array.isArray(content)) return undefined;
        const toolCalls = content.filter(isToolCallBlock);
        if (toolCalls.length === 0) return undefined;
        return toolCalls.map(tc => {
          const interactionKind = toolInteractionKind(tc.name);
          return {
            type: 'tool_use' as const,
            toolUseId: tc.id,
            toolName: tc.name,
            toolInput: tc.arguments,
            ...(interactionKind && { toolInteractionKind: interactionKind }),
          };
        });
      }

      case 'tool_execution_update': {
        return {
          type: 'tool_activity',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          toolUseId: (event as any).toolCallId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          toolName: (event as any).toolName,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          content: extractPartialText((event as any).partialResult),
        };
      }

      case 'tool_execution_end': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolUseId = (event as any).toolCallId;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolName = (event as any).toolName;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = (event as any).result;
        // pi-core only sets isError when a tool throws; zclaudia tools report
        // failures as normal returns with details.ok=false, which must count
        // as tool errors too (DB is_error, UI badges, loop guards).
        const resultDetails = (result as { details?: { ok?: unknown } } | undefined)?.details;
        const toolResultEvent: ProviderRuntimeEvent = {
          type: 'tool_result',
          toolUseId,
          toolName,
          toolResult: result,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isToolError: Boolean((event as any).isError) || resultDetails?.ok === false,
        };
        const transition = planModeTransitionEvent(toolName, toolUseId, result);
        return transition ? [toolResultEvent, transition] : toolResultEvent;
      }

      // Explicit no-ops
      case 'tool_execution_start':
      case 'turn_start':
      case 'turn_end':
      case 'message_start':
        return undefined;

      default:
        return undefined;
    }
  } catch (err) {
    console.warn('[translateToolEvent] failed:', err);
    return undefined;
  }
}
