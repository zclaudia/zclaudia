import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { ClaudeMessage } from '../message-types.js';

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
        typeof b === 'object' && b !== null && (b as { type?: unknown }).type === 'text',
    )
    .map((b: unknown) => String((b as { text?: unknown }).text ?? ''))
    .join('');
}

/**
 * Translate pi tool-related AgentEvents into ZClaudia ClaudeMessage(s).
 * Returns:
 *  - undefined — event ignored
 *  - ClaudeMessage — one event to push
 *  - ClaudeMessage[] — multiple to push (e.g. assistant with N toolCalls)
 */
export function translateToolEvent(
  event: AgentEvent,
  _ctx: TranslateToolContext,
): ClaudeMessage | ClaudeMessage[] | undefined {
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
        return toolCalls.map(tc => ({
          type: 'tool_use' as const,
          toolUseId: tc.id,
          toolName: tc.name,
          toolInput: tc.arguments,
        }));
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
        return {
          type: 'tool_result',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          toolUseId: (event as any).toolCallId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          toolName: (event as any).toolName,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          toolResult: (event as any).result,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isToolError: Boolean((event as any).isError),
        };
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
