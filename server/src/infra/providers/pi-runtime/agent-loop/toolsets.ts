import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ToolName } from '@zclaudia/shared/core/tools';
import type { AgentLoopPermissionMode } from '../../../../domains/agent-loop/index.js';
import { buildTools } from '../tool-bridge.js';

export interface ToolsetContext {
  cwd: string;
  db?: import('better-sqlite3').Database;
}

export interface AgentLoopToolsetDescriptor {
  readonly id: string;
  readonly tools: readonly ToolName[];
  readonly createOverrides?: (ctx: ToolsetContext) => Record<string, AgentTool>;
  readonly permissionMode: AgentLoopPermissionMode;
  readonly sandboxReadOnly: boolean;
}

type MutableAgentLoopToolsetDescriptor = {
  -readonly [K in keyof AgentLoopToolsetDescriptor]: AgentLoopToolsetDescriptor[K];
};

const BUILTIN_AGENT_LOOP_TOOLSET_DEFINITIONS: Record<string, MutableAgentLoopToolsetDescriptor> = {
  none: {
    id: 'none',
    tools: [],
    permissionMode: 'deny-external',
    sandboxReadOnly: true,
  },
  'permission-review': {
    id: 'permission-review',
    tools: ['Read', 'Glob', 'Grep', 'LS'],
    permissionMode: 'allow-declared-tools',
    sandboxReadOnly: true,
  },
  'code-review-readonly': {
    id: 'code-review-readonly',
    tools: ['Read', 'Glob', 'Grep', 'LS', 'Bash'],
    permissionMode: 'allow-declared-tools',
    sandboxReadOnly: true,
  },
  'workflow-prompt-readonly': {
    id: 'workflow-prompt-readonly',
    tools: ['Read', 'Glob', 'Grep', 'LS', 'Bash'],
    permissionMode: 'allow-declared-tools',
    sandboxReadOnly: true,
  },
  'workflow-prompt': {
    id: 'workflow-prompt',
    tools: ['Read', 'Glob', 'Grep', 'LS', 'Bash', 'Edit', 'MultiEdit', 'Write'],
    permissionMode: 'allow-declared-tools',
    sandboxReadOnly: false,
  },
};

function freezeBuiltinToolsetDescriptor(descriptor: MutableAgentLoopToolsetDescriptor): AgentLoopToolsetDescriptor {
  return Object.freeze({
    ...descriptor,
    tools: Object.freeze([...descriptor.tools]) as readonly ToolName[],
  });
}

export const BUILTIN_AGENT_LOOP_TOOLSETS: Readonly<Record<string, AgentLoopToolsetDescriptor>> = Object.freeze(
  Object.fromEntries(
    Object.entries(BUILTIN_AGENT_LOOP_TOOLSET_DEFINITIONS).map(([id, descriptor]) => [
      id,
      freezeBuiltinToolsetDescriptor(descriptor),
    ]),
  ),
);

export function getAgentLoopToolsetDescriptor(id: string): AgentLoopToolsetDescriptor | undefined {
  return BUILTIN_AGENT_LOOP_TOOLSETS[id];
}

export function buildAgentLoopTools(args: {
  cwd: string;
  toolsetId: string;
  overrides?: Record<string, AgentTool>;
  db?: import('better-sqlite3').Database;
}): AgentTool[] {
  const descriptor = getAgentLoopToolsetDescriptor(args.toolsetId);
  if (!descriptor) {
    throw new Error(`Unknown agent-loop toolset: ${args.toolsetId}`);
  }

  const descriptorOverrides = descriptor.createOverrides?.({ cwd: args.cwd, db: args.db });
  return buildTools(args.cwd, {
    enabled: [...descriptor.tools],
    overrides: {
      ...(descriptorOverrides ?? {}),
      ...(args.overrides ?? {}),
    },
    db: args.db,
    sandboxReadOnly: descriptor.sandboxReadOnly,
  });
}
