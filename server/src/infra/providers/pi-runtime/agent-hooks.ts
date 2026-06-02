import { newId } from '../../../utils/uuid.js';

import type { AgentLoopConfig, StreamFn } from '@earendil-works/pi-agent-core';
import { truncateHead, truncateTail, DEFAULT_MAX_LINES, type TruncationResult } from '@earendil-works/pi-agent-core';
import type { PermissionCallback } from '../types.js';

export const DEFAULT_OUTPUT_LIMIT_BYTES = 64 * 1024;

/**
 * Map pi's lowercase tool names to ZClaudia's canonical (Claude Code style)
 * tool names. This is required because ZClaudia's permission classifier
 * (`permission-evaluator.ts`) uses case-sensitive lookups against tool name
 * lists like `EDIT_TOOLS = ['Write', 'Edit', 'NotebookEdit']`. Without
 * normalization, pi tools would fall into the default category and bypass
 * the permission UI.
 *
 * We only normalize the name passed to `permissionCallback`; pi's tool
 * definitions themselves keep the lowercase names so we don't break the
 * pi-coding-agent contract.
 */
const PI_TO_CANONICAL_TOOL: Record<string, string> = {
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  bash: 'Bash',
  grep: 'Grep',
  // pi's `find` is a glob-style file finder; Claude Code's equivalent is `Glob`.
  find: 'Glob',
  ls: 'LS',
};

function canonicalToolName(piName: string): string {
  return PI_TO_CANONICAL_TOOL[piName] ?? piName;
}

/**
 * Tools whose output is more useful from the head (file reads, listings, search hits).
 * Bash and unknown tools default to tail (errors/results usually at the end).
 */
const HEAD_TRUNC_TOOLS = new Set<string>(['read', 'grep', 'find', 'ls']);

/** Reserve bytes per block for the appended truncation marker. Conservative upper bound. */
const TRUNC_MARKER_OVERHEAD_BYTES = 40;
/** Floor so a tiny-share block still gets meaningful output. */
const MIN_PER_BLOCK_BUDGET_BYTES = 64;

function selectTruncDirection(toolName: string): 'head' | 'tail' {
  return HEAD_TRUNC_TOOLS.has(toolName.toLowerCase()) ? 'head' : 'tail';
}

/**
 * Build a short, human-readable preview of the tool call for the permission
 * UI dialog. Avoids dumping huge arg payloads. Falls back to a truncated
 * JSON string when no specific extractor applies.
 */
function buildToolDetail(piToolName: string, args: unknown): string {
  if (typeof args !== 'object' || args === null) return piToolName;
  const argsObj = args as Record<string, unknown>;

  if (piToolName === 'bash' && typeof argsObj.command === 'string') {
    return argsObj.command;
  }
  if ((piToolName === 'read' || piToolName === 'edit' || piToolName === 'write')
      && typeof argsObj.path === 'string') {
    return argsObj.path;
  }
  if (piToolName === 'grep' && typeof argsObj.pattern === 'string') {
    return `grep "${argsObj.pattern}"`;
  }
  if (piToolName === 'find' && typeof argsObj.pattern === 'string') {
    return `find ${argsObj.pattern}`;
  }
  if (piToolName === 'ls' && typeof argsObj.path === 'string') {
    return `ls ${argsObj.path}`;
  }

  const json = JSON.stringify(args);
  return json.length > 120 ? json.slice(0, 117) + '...' : json;
}

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
 *
 * Delegates per-block to pi-agent-core `truncateHead` / `truncateTail` (line-aware,
 * UTF-8 surrogate safe). Direction chosen by tool: file-read tools keep the head,
 * bash and unknowns keep the tail.
 */
export function truncateContent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: Array<{ type: string; text?: string; [k: string]: any }>,
  toolName: string,
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

  const direction = selectTruncDirection(toolName);
  const truncFn = direction === 'head' ? truncateHead : truncateTail;

  // Per-block budget proportional to its share of total bytes (subtract small
  // overhead per block for the truncation marker we append on truncated blocks).
  const truncated = content.map(block => {
    if (block.type !== 'text' || typeof block.text !== 'string') return block;
    const blockBytes = Buffer.byteLength(block.text, 'utf8');
    const perBlockLimit = Math.max(
      MIN_PER_BLOCK_BUDGET_BYTES,
      Math.floor((limit * blockBytes) / totalSize) - TRUNC_MARKER_OVERHEAD_BYTES,
    );
    const result: TruncationResult = truncFn(block.text, {
      maxBytes: perBlockLimit,
      maxLines: DEFAULT_MAX_LINES,
    });
    if (!result.truncated) return { ...block, text: result.content };
    const omittedBytes = result.totalBytes - result.outputBytes;
    const marker = `\n... [truncated ${direction}, ${omittedBytes} bytes omitted]`;
    return { ...block, text: result.content + marker };
  });

  return { content: truncated, didTruncate: true, originalSize: totalSize };
}

export function buildAgentHooks(input: AgentHooksInput): AgentHooksOutput {
  const limit = input.outputTruncationLimit ?? DEFAULT_OUTPUT_LIMIT_BYTES;

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    beforeToolCall: async (ctx: any) => {
      const { toolCall, args } = ctx;
      const piName: string = toolCall.name;
      const decision = await input.permissionCallback({
        requestId: newId(),
        toolName: canonicalToolName(piName),
        toolInput: args,
        detail: buildToolDetail(piName, args),
        timeoutSeconds: 0,
      });

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
      const { result, toolCall } = ctx;
      if (!result?.content) return undefined;
      const toolName: string = toolCall?.name ?? '';
      const truncated = truncateContent(result.content, toolName, limit);
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
