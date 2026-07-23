import type { AgentTool } from '@earendil-works/pi-agent-core';
import * as path from 'path';
import type { ToolName } from '@zclaudia/shared/core/tools';
import { SESSION_WORKTREES_DIR } from '../../../utils/agent-worktrees.js';

export interface ToolExecutionEvent {
  toolName: ToolName;
  cwd: string;
  params: Record<string, unknown>;
  touchedPaths: string[];
}

export interface ToolExecutionObserver {
  afterToolExecute?: (event: ToolExecutionEvent) => void | Promise<void>;
}

type ToolExecute = AgentTool['execute'];
type ToolSignal = Parameters<ToolExecute>[2];
type ToolUpdate = Parameters<ToolExecute>[3];

export function toolParams(first: unknown, second: unknown): Record<string, unknown> {
  const candidate = second ?? first;
  return candidate && typeof candidate === 'object' ? (candidate as Record<string, unknown>) : {};
}

// Mirrors slugify() in utils/agent-worktrees.ts (not exported there) — the
// EnterWorktree `name` argument materializes at .worktrees/sessions/<slug>.
// Keep the two in sync.
function worktreeSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'wt'
  );
}

/**
 * The primary workspace path a tool call touches, derived from the
 * model-visible args. Single extraction point shared by the execution
 * observer (skill activation) and tool telemetry so both agree on what "the
 * file" of a call is; covers every path-carrying built-in tool. Returns
 * undefined for tools without a path argument — ExitWorktree included: its
 * target (the main worktree root) is session state, not an args value.
 */
export function extractToolPathParam(
  toolName: ToolName | string,
  params: Record<string, unknown> | undefined
): string | undefined {
  const value = (() => {
    switch (toolName) {
      case 'Read':
      case 'Write':
      case 'Edit':
      case 'MultiEdit':
      case 'ReadSymbol':
      case 'EditSymbol':
      case 'Grep':
      case 'Glob':
      case 'LS':
      case 'AstGrep':
      case 'AstEdit':
        return params?.path ?? params?.file_path ?? params?.filePath;
      case 'EnterWorktree': {
        const name = params?.name;
        return typeof name === 'string'
          ? path.join(SESSION_WORKTREES_DIR, worktreeSlug(name))
          : undefined;
      }
      default:
        return undefined;
    }
  })();
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function extractTouchedPaths(toolName: ToolName, params: Record<string, unknown>): string[] {
  const value = extractToolPathParam(toolName, params);
  return value ? [value] : [];
}

export function withToolName(tool: AgentTool, name: ToolName, label: string = name): AgentTool {
  return { ...tool, name, label };
}

export function withToolExecutionObserver(
  tool: AgentTool,
  name: ToolName,
  cwd: string,
  observer?: ToolExecutionObserver
): AgentTool {
  const originalExecute = tool.execute;
  if (!originalExecute) return tool;
  return {
    ...tool,
    execute: async (
      toolCallId: string,
      params: unknown,
      signal?: ToolSignal,
      onUpdate?: ToolUpdate
    ) => {
      const result = await originalExecute(toolCallId, params, signal, onUpdate);
      if (observer?.afterToolExecute) {
        const eventParams = toolParams(toolCallId, params);
        // P1-8: an observer must never corrupt a run. If the callback rejects
        // AFTER the tool already succeeded, pi-agent-core converts the
        // rejection into an error tool result that REPLACES the real result.
        // Observability is strictly best-effort — swallow and log.
        // (There is no beforeToolExecute observer path in this module; the
        // only pre-execution hooks are agent-hooks beforeToolCall, where a
        // permission/user-hook denial blocking execution is intended.)
        try {
          await observer.afterToolExecute({
            toolName: name,
            cwd,
            params: eventParams,
            touchedPaths: extractTouchedPaths(name, eventParams),
          });
        } catch (err) {
          console.warn(`[tool-observer] afterToolExecute failed for ${name}:`, err);
        }
      }
      return result;
    },
  };
}
