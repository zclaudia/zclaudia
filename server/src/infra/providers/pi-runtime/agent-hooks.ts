import { newId } from '../../../utils/uuid.js';

import type { AgentLoopConfig, StreamFn } from '@earendil-works/pi-agent-core';
import { truncateHead, truncateTail, DEFAULT_MAX_LINES, type TruncationResult } from '@earendil-works/pi-agent-core';
import type { PermissionCallback } from '../types.js';
import type { UserHookDefinition } from '@zclaudia/shared/interaction/user-hooks';
import { runPreToolUseHooks, runPostToolUseHooks } from './user-hooks.js';
import { measureTextBytes, persistToolResultText } from './tool-result-store.js';
import { loopRecoveryForFailure, remediationForResult } from './remediation.js';
import { ToolFailureLoopGuard, TOOL_FAILURE_HARD_LIMIT } from './tool-failure-loop-guard.js';
import { ToolCallTelemetry } from './tool-telemetry.js';

export const DEFAULT_OUTPUT_LIMIT_BYTES = 64 * 1024;

/** Per-turn budget for cumulative tool-result text; overflow goes to disk. */
export const DEFAULT_TURN_BUDGET_BYTES = 192 * 1024;
/** Results below this size always stay inline, even over budget. */
const PERSIST_MIN_BYTES = 4 * 1024;
/** Inline preview size for a persisted result. */
const PERSIST_PREVIEW_BYTES = 1024;

/**
 * Once Edit has been called on the same file this many times in one turn,
 * append an advisory pushing the model toward Write / the `patch` parameter.
 * Threshold sits above "legitimate 3-spot fine edit" and below the typical
 * "model is fumbling a Markdown table" loop (5+ Edits).
 */
const EDIT_FLOOD_THRESHOLD = 4;

/**
 * Tools whose output is more useful from the head (file reads, listings, search hits).
 * Bash and unknown tools default to tail (errors/results usually at the end).
 */
const HEAD_TRUNC_TOOLS = new Set<string>(['read', 'grep', 'glob', 'ls']);

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
function buildToolDetail(toolName: string, args: unknown): string {
  if (typeof args !== 'object' || args === null) return toolName;
  const argsObj = args as Record<string, unknown>;

  if (toolName === 'Bash' && typeof argsObj.command === 'string') {
    return argsObj.command;
  }
  if (toolName === 'Read' || toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'Write' || toolName === 'ReadSymbol' || toolName === 'EditSymbol') {
    const filePath = argsObj.file_path ?? argsObj.path;
    if (typeof filePath === 'string') return filePath;
  }
  if (toolName === 'Grep' && typeof argsObj.pattern === 'string') {
    return `grep "${argsObj.pattern}"`;
  }
  if (toolName === 'Glob' && typeof argsObj.pattern === 'string') {
    return `glob ${argsObj.pattern}`;
  }
  if (toolName === 'LS' && typeof argsObj.path === 'string') {
    return `ls ${argsObj.path}`;
  }
  if (toolName === 'AskUserQuestion' && Array.isArray(argsObj.questions)) {
    const [firstQuestion] = argsObj.questions;
    if (firstQuestion && typeof firstQuestion === 'object') {
      const question = (firstQuestion as { question?: unknown }).question;
      if (typeof question === 'string' && question.trim()) {
        const extra = argsObj.questions.length > 1 ? ` (+${argsObj.questions.length - 1} more)` : '';
        return question.trim() + extra;
      }
    }
  }

  const json = JSON.stringify(args);
  return json.length > 120 ? json.slice(0, 117) + '...' : json;
}

export interface AgentHooksInput {
  permissionCallback: PermissionCallback;
  abortSignal?: AbortSignal;
  /** Output truncation limit in bytes. Default: 64 KiB. */
  outputTruncationLimit?: number;
  /** Per-turn cumulative tool-result budget in bytes (default 192 KiB; 0 disables).
   *  Once exceeded, large results are persisted to disk with an inline preview. */
  toolResultBudgetBytes?: number;
  /** Append auto-fix remediation hints to recognizable tool failures (default on). */
  autoFixHints?: boolean;
  /** Architectural placeholders for future sub-projects. */
  transformContext?: AgentLoopConfig['transformContext'];
  /** Stream function for the agent loop. Note: pi accepts this as a separate argument to
   *  agentLoop(), not as part of AgentLoopConfig. We pass it through for callers to wire. */
  streamFn?: StreamFn;
  /** Declarative user hooks (resolved per run); absent = none. */
  userHooks?: UserHookDefinition[];
  /** Workspace root for hook execution. */
  cwd?: string;
  /** Session id forwarded to hook processes via the stdin payload. */
  sessionId?: string;
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
  const turnBudgetBytes = input.toolResultBudgetBytes ?? DEFAULT_TURN_BUDGET_BYTES;
  const autoFixHints = input.autoFixHints ?? true;
  let turnSpentBytes = 0;
  // Tracks how many times Edit has hit each file path in the current turn.
  // Reset on shouldStopAfterTurn alongside turnSpentBytes.
  const editAttemptsByPath = new Map<string, number>();
  const toolFailureGuard = new ToolFailureLoopGuard();
  const toolTelemetry = new ToolCallTelemetry();

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    beforeToolCall: async (ctx: any) => {
      const { toolCall, args } = ctx;
      const toolName: string = toolCall.name;
      if (toolName === 'AskUserQuestion') {
        return undefined;
      }
      const decision = await input.permissionCallback({
        requestId: newId(),
        toolName,
        toolInput: args,
        detail: buildToolDetail(toolName, args),
        timeoutSeconds: 0,
      });

      if (decision.behavior === 'deny') {
        return { block: true, reason: decision.message ?? 'denied by user' };
      }
      if (input.userHooks?.length) {
        // Hooks see the ORIGINAL model-supplied args — decision.updatedInput
        // may embed decrypted credentials (sudo rewrite) that must never
        // reach user hook processes.
        const outcome = await runPreToolUseHooks(input.userHooks, {
          event: 'PreToolUse',
          toolName,
          toolInput: args,
          detail: buildToolDetail(toolName, args),
          cwd: input.cwd ?? process.cwd(),
          sessionId: input.sessionId,
        }, input.abortSignal);
        if (outcome.blocked) return { block: true, reason: outcome.reason };
      }
      if (decision.updatedInput !== undefined) {
        return { args: decision.updatedInput };
      }
      return undefined;
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    afterToolCall: async (ctx: any) => {
      const { result, toolCall, args } = ctx;
      if (!result?.content) return undefined;
      const toolName: string = toolCall?.name ?? '';
      let content = result.content;
      let hookAppended = false;
      let telemetryUpdated = false;
      let detailsUpdated = false;
      // Auto-fix: append a concrete next step for recognizable failures so the
      // model self-corrects instead of blindly retrying.
      let remediationAppended = false;
      if (autoFixHints) {
        const hint = remediationForResult(toolName, result.details);
        if (hint) {
          content = [...content, { type: 'text', text: `[fix] ${hint}` }];
          remediationAppended = true;
        }
      }

      // Edit flood advisory: when Edit keeps hitting the same file, the model
      // is usually fighting structural cascade (Markdown table / JSON array /
      // indentation drift) — point it at MultiEdit, Write, or the `patch` parameter
      // before it burns more turns. Counts both successes and failures (the
      // failure remediation hints already exist; this is the aggregate signal).
      // A successful Write clears the counter so post-rewrite Edits start fresh.
      if (autoFixHints && toolName === 'Edit' && typeof args?.file_path === 'string') {
        const key = args.file_path.trim();
        if (key) {
          const next = (editAttemptsByPath.get(key) ?? 0) + 1;
          editAttemptsByPath.set(key, next);
          result.details = {
            ...(result.details ?? {}),
            mutationBudget: {
              tool: 'Edit',
              path: key,
              attemptsThisTurn: next,
              advisoryThreshold: EDIT_FLOOD_THRESHOLD,
              remainingBeforeAdvisory: Math.max(EDIT_FLOOD_THRESHOLD - next, 0),
              batchConsumesOneAttempt: true,
              failedAttemptsCount: true,
            },
          };
          detailsUpdated = true;
          if (next >= EDIT_FLOOD_THRESHOLD) {
            const advisory = `Edit has now run ${next} times against ${key} this turn. For several replacements in this same file, use MultiEdit so the file is written once. If you're rewriting a structural file (Markdown tables, JSON arrays, indented YAML), switch to a single Write; for multi-file changes, use Edit's \`patch\` parameter.`;
            content = [...content, { type: 'text', text: `[fix] ${advisory}` }];
            remediationAppended = true;
          }
        }
      }
      if (toolName === 'Write' && typeof args?.file_path === 'string' && result?.details?.ok !== false) {
        const key = args.file_path.trim();
        if (key) editAttemptsByPath.delete(key);
      }
      if (input.userHooks?.length) {
        const extras = await runPostToolUseHooks(input.userHooks, {
          event: 'PostToolUse',
          toolName,
          toolInput: args,
          detail: buildToolDetail(toolName, args),
          cwd: input.cwd ?? process.cwd(),
          sessionId: input.sessionId,
        }, input.abortSignal);
        if (extras.length > 0) {
          content = [...content, ...extras.map((text: string) => ({ type: 'text', text: `[hook] ${text}` }))];
          hookAppended = true;
        }
      }

      // Tool failure loop guard: track consecutive identical failures; once the
      // hard limit is reached, append a [loop] nudge and upgrade the error code
      // so the model knows it must change strategy rather than retry blindly.
      const isFailure = result?.details?.ok === false;
      const alreadyLoopDetected =
        typeof result?.details?.error === 'string' &&
        result.details.error.endsWith('_loop_detected');
      if (isFailure && !alreadyLoopDetected) {
        const loopAttempt = toolFailureGuard.recordFailureWithResult(
          toolName,
          args as Record<string, unknown> | undefined,
          result.details as Record<string, unknown> | undefined,
        );
        const attempts = loopAttempt.attempts;
        if (attempts >= TOOL_FAILURE_HARD_LIMIT) {
          const loopRecovery = loopRecoveryForFailure(
            toolName,
            args as Record<string, unknown> | undefined,
            result.details as Record<string, unknown> | undefined,
            attempts,
          );
          const bashDetails = loopAttempt.kind === 'bash_failure' ? result.details as Record<string, unknown> | undefined : undefined;
          const sameFailure = Array.isArray(bashDetails?.diagnostics) && bashDetails.diagnostics.length > 0
            ? 'the same diagnostics'
            : Array.isArray(bashDetails?.failedTests) && bashDetails.failedTests.length > 0
              ? 'the same failed tests'
              : 'the same failure result';
          const baseLoopText = loopAttempt.kind === 'bash_failure'
            ? `This Bash command has failed ${attempts} times with ${sameFailure}. Stop re-running it unchanged — inspect the reported files/tests, edit the underlying cause, or run a different diagnostic command.`
            : `This tool call has failed ${attempts} times with identical inputs. Stop retrying the same call — change the approach, inspect prerequisites, or ask the user.`;
          const recoveryText = loopRecovery
            ? ` Recovery: ${loopRecovery.summary} ${loopRecovery.steps.join(' ')}`
            : '';
          const loopText = baseLoopText + recoveryText;
          content = [
            ...content,
            {
              type: 'text',
              text: `[loop] ${loopText}`,
            },
          ];
          // Upgrade the error code so remediationForResult stays silent (it's in
          // SELF_EXPLANATORY) and downstream readers can detect the loop.
          result.details = {
            ...result.details,
            error: loopAttempt.kind === 'bash_failure' ? 'bash_failure_loop_detected' : 'tool_loop_detected',
            loopAttempts: attempts,
            loopKind: loopAttempt.kind,
            ...(loopRecovery ? { loopRecovery } : {}),
          };
          remediationAppended = true; // also covers [loop] nudge — ensures modified result is returned
        }
      } else if (result?.details?.ok === true) {
        toolFailureGuard.recordSuccess(toolName, args as Record<string, unknown> | undefined);
      }

      const telemetry = toolTelemetry.record(toolName, args as Record<string, unknown> | undefined, {
        content,
        details: result.details as Record<string, unknown> | undefined,
      });
      if (telemetry.advisories.length > 0) {
        content = [
          ...content,
          ...telemetry.advisories.map(text => ({ type: 'text', text: `[telemetry] ${text}` })),
        ];
        telemetryUpdated = true;
      }
      if (telemetry.notable) {
        result.details = { ...(result.details ?? {}), toolTelemetry: telemetry.snapshot };
        telemetryUpdated = true;
      }

      const truncated = truncateContent(content, toolName, limit);
      const finalContent = truncated.didTruncate ? truncated.content : content;
      const finalSize = measureTextBytes(finalContent);

      // Per-turn budget: once cumulative tool-result text exceeds the budget,
      // large results move to disk and only a preview plus the file path stays
      // in context (the model can Read the file back when it needs the rest).
      if (turnBudgetBytes > 0
        && finalSize > PERSIST_MIN_BYTES
        && turnSpentBytes + finalSize > turnBudgetBytes) {
        const persisted = persistToolResultText(toolName, content);
        if (persisted) {
          const direction = selectTruncDirection(toolName);
          const previewFn = direction === 'head' ? truncateHead : truncateTail;
          const previewSource = content
            .filter((block: { type: string; text?: string }) => block.type === 'text' && typeof block.text === 'string')
            .map((block: { text?: string }) => block.text as string)
            .join('\n');
          const preview = previewFn(previewSource, { maxBytes: PERSIST_PREVIEW_BYTES, maxLines: DEFAULT_MAX_LINES });
          const note = `[Tool result (${persisted.size} bytes) exceeded this turn's context budget and was saved to `
            + `${persisted.filePath} — Read that file if you need the full output. Preview (${direction}):]\n${preview.content}`;
          const replacement = [
            ...content.filter((block: { type: string }) => block.type !== 'text'),
            { type: 'text', text: note },
          ];
          turnSpentBytes += measureTextBytes(replacement);
          return {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            content: replacement as any,
            details: {
              ...(result.details ?? {}),
              budgetExceeded: true,
              persistedPath: persisted.filePath,
              originalSize: persisted.size,
              ...(telemetryUpdated ? { toolTelemetry: telemetry.snapshot } : {}),
            },
          };
        }
      }
      turnSpentBytes += finalSize;

      if (!truncated.didTruncate && !hookAppended && !remediationAppended && !telemetryUpdated && !detailsUpdated) return undefined;
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: finalContent as any,
        details: truncated.didTruncate
          ? { ...(result.details ?? {}), truncated: true, originalSize: truncated.originalSize }
          : result.details,
      };
    },

    shouldStopAfterTurn: async () => {
      turnSpentBytes = 0;
      editAttemptsByPath.clear();
      return input.abortSignal?.aborted ?? false;
    },

    transformContext: input.transformContext,
    streamFn: input.streamFn,
  };
}
