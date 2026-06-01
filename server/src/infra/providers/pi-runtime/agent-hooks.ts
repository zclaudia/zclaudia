import type { AgentLoopConfig, StreamFn } from '@earendil-works/pi-agent-core';
import type { PermissionCallback } from '../types.js';

export const DEFAULT_OUTPUT_LIMIT_BYTES = 64 * 1024;

export interface AgentHooksInput {
  permissionCallback: PermissionCallback;
  abortSignal?: AbortSignal;
  /** Output truncation limit in bytes. Default: 64 KiB. */
  outputTruncationLimit?: number;
  /** Architectural placeholders for future sub-projects. */
  transformContext?: AgentLoopConfig['transformContext'];
  /** Stream function for the agent loop. Note: pi accepts this as a separate argument to
   *  agentLoop(), not as part of AgentLoopConfig. We pass it through for callers to wire. */
  streamFn?: StreamFn;
}

export interface AgentHooksOutput {
  beforeToolCall: AgentLoopConfig['beforeToolCall'];
  afterToolCall: AgentLoopConfig['afterToolCall'];
  shouldStopAfterTurn: AgentLoopConfig['shouldStopAfterTurn'];
  transformContext?: AgentLoopConfig['transformContext'];
  streamFn?: StreamFn;
}

export interface TruncateResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: Array<{ type: string; text?: string; [k: string]: any }>;
  didTruncate: boolean;
  originalSize: number;
}

/**
 * Truncate a tool result's text content to a byte limit. Non-text blocks pass through.
 */
export function truncateContent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: Array<{ type: string; text?: string; [k: string]: any }>,
  limit: number,
): TruncateResult {
  let totalSize = 0;
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      totalSize += Buffer.byteLength(block.text, 'utf8');
    }
  }

  if (totalSize <= limit) {
    return { content, didTruncate: false, originalSize: totalSize };
  }

  const factor = limit / totalSize;
  const truncated = content.map(block => {
    if (block.type !== 'text' || typeof block.text !== 'string') return block;
    const targetLen = Math.floor(block.text.length * factor);
    const head = block.text.slice(0, Math.max(0, targetLen - 40));
    const marker = `\n... [truncated, ${block.text.length - head.length} bytes omitted]`;
    return { ...block, text: head + marker };
  });

  return { content: truncated, didTruncate: true, originalSize: totalSize };
}

export function buildAgentHooks(input: AgentHooksInput): AgentHooksOutput {
  const limit = input.outputTruncationLimit ?? DEFAULT_OUTPUT_LIMIT_BYTES;

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    beforeToolCall: async (ctx: any) => {
      const { toolCall, args } = ctx;
      const decision = await input.permissionCallback({
        toolUseId: toolCall.id,
        toolName: toolCall.name,
        toolInput: args,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      if (decision.behavior === 'deny') {
        return { block: true, reason: decision.message ?? 'denied by user' };
      }
      if (decision.updatedInput !== undefined) {
        return { args: decision.updatedInput };
      }
      return undefined;
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    afterToolCall: async (ctx: any) => {
      const { result } = ctx;
      if (!result?.content) return undefined;
      const truncated = truncateContent(result.content, limit);
      if (!truncated.didTruncate) return undefined;
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: truncated.content as any,
        details: { ...(result.details ?? {}), truncated: true, originalSize: truncated.originalSize },
      };
    },

    shouldStopAfterTurn: async () => {
      return input.abortSignal?.aborted ?? false;
    },

    transformContext: input.transformContext,
    streamFn: input.streamFn,
  };
}
