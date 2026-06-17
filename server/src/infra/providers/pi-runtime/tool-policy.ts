import { READ_ONLY_TOOL_NAMES, type ToolName } from '@zclaudia/shared/core/tools';

/**
 * Resolve the effective tool set for a run.
 *
 * In plan mode the agent is restricted to read-only tools. When the sandbox is
 * available, Bash is also allowed (it will be invoked with sandboxReadOnly:true
 * so writes are blocked at the OS level). Non-plan mode passes the requested
 * tools through unchanged.
 */
export function resolvePlanModeTools(
  requestedTools: ToolName[],
  isPlanMode: boolean,
  sandboxAvailable: boolean,
): ToolName[] {
  if (!isPlanMode) return requestedTools;
  const allowed = sandboxAvailable
    ? new Set<ToolName>([...READ_ONLY_TOOL_NAMES, 'Bash'])
    : new Set<ToolName>(READ_ONLY_TOOL_NAMES);
  return requestedTools.filter((t) => allowed.has(t));
}
