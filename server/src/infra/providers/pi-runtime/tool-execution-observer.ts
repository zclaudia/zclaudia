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

export function toolParams(first: unknown, second: unknown): Record<string, unknown> {
  const candidate = second ?? first;
  return candidate && typeof candidate === 'object'
    ? candidate as Record<string, unknown>
    : {};
}

export function extractTouchedPaths(toolName: ToolName, params: Record<string, unknown>): string[] {
  const value = (() => {
    if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') return params.path ?? params.file_path;
    if (toolName === 'Grep' || toolName === 'Glob' || toolName === 'LS') return params.path;
    return undefined;
  })();
  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

export function withToolName(tool: AgentTool<any>, name: ToolName, label: string = name): AgentTool<any> {
  return { ...tool, name, label } as AgentTool<any>;
}

export function withToolExecutionObserver(
  tool: AgentTool<any>,
  name: ToolName,
  cwd: string,
  observer?: ToolExecutionObserver,
): AgentTool<any> {
  const originalExecute = tool.execute;
  if (!originalExecute) return tool;
  return {
    ...tool,
    execute: async (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: any) => {
      const result = await originalExecute(toolCallId, params, signal, onUpdate);
      if (observer?.afterToolExecute) {
        const eventParams = toolParams(toolCallId, params);
        await observer.afterToolExecute({
          toolName: name,
          cwd,
          params: eventParams,
          touchedPaths: extractTouchedPaths(name, eventParams),
        });
      }
      return result;
    },
  } as AgentTool<any>;
}
