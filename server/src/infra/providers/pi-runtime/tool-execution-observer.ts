import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ToolName } from '@zclaudia/shared/core/tools';

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

export function extractTouchedPaths(toolName: ToolName, params: Record<string, unknown>): string[] {
  const value = (() => {
    if (
      toolName === 'Read' ||
      toolName === 'Write' ||
      toolName === 'Edit' ||
      toolName === 'MultiEdit' ||
      toolName === 'ReadSymbol' ||
      toolName === 'EditSymbol'
    )
      return params.path ?? params.file_path;
    if (toolName === 'Grep' || toolName === 'Glob' || toolName === 'LS') return params.path;
    return undefined;
  })();
  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
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
