import {
  createReadTool,
  createWriteTool,
  createEditTool,
  createBashTool,
  createGrepTool,
  createFindTool,
  createLsTool,
} from '@earendil-works/pi-coding-agent';
import type { AgentTool } from '@earendil-works/pi-agent-core';

export type ToolName = 'read' | 'write' | 'edit' | 'bash' | 'grep' | 'find' | 'ls';

export const ALL_TOOL_NAMES: readonly ToolName[] = [
  'read',
  'write',
  'edit',
  'bash',
  'grep',
  'find',
  'ls',
] as const;

const KNOWN_TOOL_SET = new Set<string>(ALL_TOOL_NAMES);

// Dispatch table: tool name → factory taking (cwd, options?) and returning an AgentTool.
// Each pi factory accepts an optional per-tool options object; we don't expose those
// in this MVP (use pi defaults). Future sub-projects can wire ToolBridgeOptions.<name>
// through to the factory.
const TOOL_FACTORIES: Record<
  ToolName,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (cwd: string) => AgentTool<any>
> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  read: (cwd) => createReadTool(cwd) as AgentTool<any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  write: (cwd) => createWriteTool(cwd) as AgentTool<any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  edit: (cwd) => createEditTool(cwd) as AgentTool<any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bash: (cwd) => createBashTool(cwd) as AgentTool<any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  grep: (cwd) => createGrepTool(cwd) as AgentTool<any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  find: (cwd) => createFindTool(cwd) as AgentTool<any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ls: (cwd) => createLsTool(cwd) as AgentTool<any>,
};

export interface ToolBridgeOptions {
  /** Subset of tools to enable. Default: all 7. */
  enabled?: ToolName[];
  /** Replace specific pi tool implementations. Key is the tool name. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  overrides?: Partial<Record<ToolName, AgentTool<any>>>;
}

/**
 * Build the AgentTool[] passed to pi `Agent`'s initialState.tools.
 *
 * `cwd` is required by pi tools to enforce a working-directory boundary
 * (e.g. read can't open files outside cwd).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildTools(cwd: string, options?: ToolBridgeOptions): AgentTool<any>[] {
  const requested = options?.enabled ?? [...ALL_TOOL_NAMES];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: AgentTool<any>[] = [];

  for (const name of requested) {
    if (!KNOWN_TOOL_SET.has(name)) {
      console.warn(`[buildTools] Unknown tool name skipped: ${name}`);
      continue;
    }
    const override = options?.overrides?.[name];
    if (override) {
      result.push(override);
    } else {
      result.push(TOOL_FACTORIES[name](cwd));
    }
  }

  return result;
}
