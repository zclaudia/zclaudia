import type { AgentTool } from '@earendil-works/pi-agent-core';
import { ALL_TOOL_NAMES, normalizeToolName, type ToolName } from '@zclaudia/shared/core/tools';
import { BUILTIN_TOOL_FACTORIES } from './tool-catalog.js';
import { buildEffectiveToolOptions, type ToolBridgeOptions } from './tool-options.js';
import { withToolExecutionObserver, withToolName } from './tool-execution-observer.js';
import { withPendingArgOverrides } from './pending-arg-overrides.js';

export { ALL_TOOL_NAMES, type ToolName };
export type { ToolBridgeOptions } from './tool-options.js';
export type { ToolExecutionEvent, ToolExecutionObserver } from './tool-execution-observer.js';

/**
 * Build the AgentTool[] passed to pi `Agent`'s initialState.tools.
 *
 * `cwd` is required by pi tools to enforce a working-directory boundary
 * (e.g. read can't open files outside cwd).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildTools(cwd: string, options?: ToolBridgeOptions): AgentTool<any>[] {
  const effectiveOptions = buildEffectiveToolOptions(cwd, options);
  const requested = options?.enabled ?? [...ALL_TOOL_NAMES];
  const overrides = new Map<ToolName, AgentTool<any>>();
  for (const [overrideName, tool] of Object.entries(effectiveOptions.overrides ?? {})) {
    const normalized = normalizeToolName(overrideName);
    if (normalized && tool) overrides.set(normalized, tool);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: AgentTool<any>[] = [];
  // Dedupe AFTER normalization: aliases ('read') and canonical names ('Read')
  // resolve to the same tool, and duplicates would produce two same-named
  // tools, which some provider APIs reject outright.
  const seen = new Set<ToolName>();

  for (const requestedName of requested) {
    const name = normalizeToolName(requestedName);
    if (!name) {
      console.warn(`[buildTools] Unknown tool name skipped: ${requestedName}`);
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    if (name === 'Memory' && !effectiveOptions.memoryDir) continue;
    const override = overrides.get(name);
    const tool = override
      ? withToolName(override, name, override.label ?? name)
      : BUILTIN_TOOL_FACTORIES[name](cwd, effectiveOptions);
    // The arg-override substitution sits INSIDE the observer wrapper on
    // purpose: observer events (telemetry, touched paths) should report the
    // model-visible args, not permission rewrites that may embed decrypted
    // credentials (sudo rewrite). Only the tool itself receives the rewrite.
    const withOverrides = effectiveOptions.argOverrides
      ? withPendingArgOverrides(tool, effectiveOptions.argOverrides)
      : tool;
    result.push(
      withToolExecutionObserver(withOverrides, name, cwd, effectiveOptions.toolExecutionObserver)
    );
  }

  return result;
}
