export const ALL_TOOL_NAMES = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Eval',
  'Grep',
  'Glob',
  'LS',
  'TodoWrite',
  'AskUserQuestion',
  'WebFetch',
  'WebSearch',
  'MCPTool',
  'ListMcpResources',
  'ReadMcpResource',
  'ToolSearch',
  'TaskOutput',
  'Monitor',
  'Agent',
  'LSPTool',
  'AstGrep',
  'AstEdit',
  'EnterWorktree',
  'ExitWorktree',
  'EnterPlanMode',
  'ExitPlanMode',
  'Memory',
] as const;

export type ToolName = typeof ALL_TOOL_NAMES[number];

export type ToolSource = 'builtin' | 'plugin' | 'mcp' | 'interaction';

export interface BuiltinToolRef {
  source: 'builtin';
  name: ToolName;
}

export interface PluginToolRef {
  source: 'plugin';
  pluginId: string;
  toolId: string;
}

export interface McpToolRef {
  source: 'mcp';
  server: string;
  tool: string;
}

export interface McpResourceRef {
  source: 'mcp-resource';
  server: string;
  uri: string;
}

export interface McpPromptRef {
  source: 'mcp-prompt';
  server: string;
  name: string;
}

export interface InteractionToolRef {
  source: 'interaction';
  toolId: string;
}

export type ToolRef = BuiltinToolRef | PluginToolRef | McpToolRef | McpResourceRef | McpPromptRef | InteractionToolRef;

export type ToolSetRef =
  | { source: 'builtin'; id: BuiltinToolSetId }
  | { source: 'plugin'; pluginId: string; id: string };

export interface McpToolProviderRef {
  source: 'mcp';
  serverId: string;
}

export interface PluginToolProviderRef {
  source: 'plugin';
  pluginId: string;
  providerId?: string;
}

export type ExternalToolProviderRef = McpToolProviderRef | PluginToolProviderRef;

export interface ToolSelection {
  sets: ToolSetRef[];
  providers?: ExternalToolProviderRef[];
  include: ToolRef[];
  exclude: ToolRef[];
}

export type ToolRiskLevel = 'low' | 'medium' | 'high';
export type PluginTrustLevel = 'untrusted' | 'trusted' | 'verified';

export interface ToolMetadata {
  ref: ToolRef;
  label: string;
  description?: string;
  setIds?: string[];
  declaredReadOnly: boolean;
  mutatesWorkspace: boolean;
  requiresNetwork: boolean;
  requiresUserInteraction: boolean;
  riskLevel: ToolRiskLevel;
}

export interface ExternalToolRiskPolicy {
  declaredReadOnly: boolean;
  declaredReadOnlySource?: 'mcp-annotations' | 'plugin-metadata';
  trustedReadOnly: boolean;
  mutatesWorkspace: boolean;
  requiresNetwork: boolean;
  riskLevel: ToolRiskLevel;
  providerTrust: PluginTrustLevel;
  policyDecision?: 'approve' | 'deny' | 'escalate';
  advisory: string;
}

export interface ResolvedToolSelection {
  refs: ToolRef[];
  builtinTools: ToolName[];
}

export const LEGACY_TOOL_NAME_ALIASES: Readonly<Record<string, ToolName>> = {
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  bash: 'Bash',
  grep: 'Grep',
  ls: 'LS',
};

/**
 * Tools that do not modify workspace state — safe to expose in Plan mode.
 * TodoWrite mutates UI state only; AskUserQuestion collects clarification.
 * write / edit mutate files. bash and Agent can execute arbitrary work.
 */
export const READ_ONLY_TOOL_NAMES: ReadonlyArray<ToolName> = [
  'Read',
  'Grep',
  'Glob',
  'LS',
  'TodoWrite',
  'AskUserQuestion',
  'WebFetch',
  'WebSearch',
  'ToolSearch',
  'ListMcpResources',
  'ReadMcpResource',
  'TaskOutput',
  'LSPTool',
  'AstGrep',
  // Plan-mode tools must survive the plan-mode read-only filter so the model
  // can always enter/exit; they mutate session state, not workspace files.
  'EnterPlanMode',
  'ExitPlanMode',
  // Memory only writes its own per-project memory directory (path safety
  // enforced inside the tool), never workspace files — saving memories during
  // plan mode is allowed. declaredReadOnly stays false in its metadata because
  // it does mutate persistent state.
  'Memory',
];

export const BUILTIN_TOOL_METADATA: Readonly<Record<ToolName, ToolMetadata>> = {
  Read: {
    ref: { source: 'builtin', name: 'Read' },
    label: 'Read',
    description: 'Read a text file with line pagination, size limits, and binary-file protection.',
    setIds: ['core-coding'],
    declaredReadOnly: true,
    mutatesWorkspace: false,
    requiresNetwork: false,
    requiresUserInteraction: false,
    riskLevel: 'low',
  },
  Write: {
    ref: { source: 'builtin', name: 'Write' },
    label: 'Write',
    description: 'Create or overwrite files in the workspace.',
    setIds: ['core-coding'],
    declaredReadOnly: false,
    mutatesWorkspace: true,
    requiresNetwork: false,
    requiresUserInteraction: false,
    riskLevel: 'medium',
  },
  Edit: {
    ref: { source: 'builtin', name: 'Edit' },
    label: 'Edit',
    description: 'Apply targeted edits to existing workspace files.',
    setIds: ['core-coding'],
    declaredReadOnly: false,
    mutatesWorkspace: true,
    requiresNetwork: false,
    requiresUserInteraction: false,
    riskLevel: 'medium',
  },
  Bash: {
    ref: { source: 'builtin', name: 'Bash' },
    label: 'Bash',
    description: 'Run shell commands from the workspace.',
    setIds: ['core-coding'],
    declaredReadOnly: false,
    mutatesWorkspace: true,
    requiresNetwork: true,
    requiresUserInteraction: false,
    riskLevel: 'high',
  },
  Eval: {
    ref: { source: 'builtin', name: 'Eval' },
    label: 'Eval',
    description: 'Run JavaScript in a persistent per-session kernel (sandboxed like Bash).',
    setIds: ['core-coding'],
    declaredReadOnly: false,
    mutatesWorkspace: true,
    requiresNetwork: true,
    requiresUserInteraction: false,
    riskLevel: 'high',
  },
  Grep: {
    ref: { source: 'builtin', name: 'Grep' },
    label: 'Grep',
    description: 'Search file contents with ripgrep and structured results.',
    setIds: ['core-coding'],
    declaredReadOnly: true,
    mutatesWorkspace: false,
    requiresNetwork: false,
    requiresUserInteraction: false,
    riskLevel: 'low',
  },
  Glob: {
    ref: { source: 'builtin', name: 'Glob' },
    label: 'Glob',
    description: 'Find files by glob pattern under the workspace.',
    setIds: ['core-coding'],
    declaredReadOnly: true,
    mutatesWorkspace: false,
    requiresNetwork: false,
    requiresUserInteraction: false,
    riskLevel: 'low',
  },
  LS: {
    ref: { source: 'builtin', name: 'LS' },
    label: 'LS',
    description: 'List directory contents.',
    setIds: ['core-coding'],
    declaredReadOnly: true,
    mutatesWorkspace: false,
    requiresNetwork: false,
    requiresUserInteraction: false,
    riskLevel: 'low',
  },
  TodoWrite: {
    ref: { source: 'builtin', name: 'TodoWrite' },
    label: 'TodoWrite',
    description: 'Update the visible task list for the user.',
    setIds: ['interaction'],
    declaredReadOnly: true,
    mutatesWorkspace: false,
    requiresNetwork: false,
    requiresUserInteraction: false,
    riskLevel: 'low',
  },
  AskUserQuestion: {
    ref: { source: 'builtin', name: 'AskUserQuestion' },
    label: 'AskUserQuestion',
    description: 'Ask the user structured questions and wait for an answer.',
    setIds: ['interaction'],
    declaredReadOnly: true,
    mutatesWorkspace: false,
    requiresNetwork: false,
    requiresUserInteraction: true,
    riskLevel: 'low',
  },
  WebFetch: {
    ref: { source: 'builtin', name: 'WebFetch' },
    label: 'WebFetch',
    description: 'Fetch a URL and return readable text content.',
    setIds: ['web'],
    declaredReadOnly: true,
    mutatesWorkspace: false,
    requiresNetwork: true,
    requiresUserInteraction: false,
    riskLevel: 'low',
  },
  WebSearch: {
    ref: { source: 'builtin', name: 'WebSearch' },
    label: 'WebSearch',
    description: 'Search the web for current information.',
    setIds: ['web'],
    declaredReadOnly: true,
    mutatesWorkspace: false,
    requiresNetwork: true,
    requiresUserInteraction: false,
    riskLevel: 'low',
  },
  MCPTool: {
    ref: { source: 'builtin', name: 'MCPTool' },
    label: 'MCPTool',
    description: 'Call a tool exposed by a configured MCP server.',
    setIds: ['mcp-control'],
    declaredReadOnly: false,
    mutatesWorkspace: false,
    requiresNetwork: true,
    requiresUserInteraction: false,
    riskLevel: 'high',
  },
  ListMcpResources: {
    ref: { source: 'builtin', name: 'ListMcpResources' },
    label: 'ListMcpResources',
    description: 'List resources exposed by configured MCP servers.',
    setIds: ['mcp-control'],
    declaredReadOnly: true,
    mutatesWorkspace: false,
    requiresNetwork: true,
    requiresUserInteraction: false,
    riskLevel: 'low',
  },
  ReadMcpResource: {
    ref: { source: 'builtin', name: 'ReadMcpResource' },
    label: 'ReadMcpResource',
    description: 'Read a resource exposed by a configured MCP server.',
    setIds: ['mcp-control'],
    declaredReadOnly: true,
    mutatesWorkspace: false,
    requiresNetwork: true,
    requiresUserInteraction: false,
    riskLevel: 'low',
  },
  ToolSearch: {
    ref: { source: 'builtin', name: 'ToolSearch' },
    label: 'ToolSearch',
    description: 'Search tools exposed by configured MCP servers.',
    setIds: ['mcp-control'],
    declaredReadOnly: true,
    mutatesWorkspace: false,
    requiresNetwork: true,
    requiresUserInteraction: false,
    riskLevel: 'low',
  },
  TaskOutput: {
    ref: { source: 'builtin', name: 'TaskOutput' },
    label: 'TaskOutput',
    description: 'Read task state, result, and lifecycle events by task id.',
    setIds: ['tasks'],
    declaredReadOnly: true,
    mutatesWorkspace: false,
    requiresNetwork: false,
    requiresUserInteraction: false,
    riskLevel: 'low',
  },
  Monitor: {
    ref: { source: 'builtin', name: 'Monitor' },
    label: 'Monitor',
    description: 'Create, inspect, or stop a monitor task.',
    setIds: ['tasks'],
    declaredReadOnly: false,
    mutatesWorkspace: false,
    requiresNetwork: false,
    requiresUserInteraction: false,
    riskLevel: 'medium',
  },
  Agent: {
    ref: { source: 'builtin', name: 'Agent' },
    label: 'Agent',
    description: 'Delegate work to a background sub-agent task.',
    setIds: ['tasks'],
    declaredReadOnly: false,
    mutatesWorkspace: true,
    requiresNetwork: true,
    requiresUserInteraction: false,
    riskLevel: 'high',
  },
  LSPTool: {
    ref: { source: 'builtin', name: 'LSPTool' },
    label: 'LSPTool',
    description: 'Find symbols, references, definitions, or diagnostics in the workspace.',
    setIds: ['code-intelligence'],
    declaredReadOnly: true,
    mutatesWorkspace: false,
    requiresNetwork: false,
    requiresUserInteraction: false,
    riskLevel: 'low',
  },
  AstGrep: {
    ref: { source: 'builtin', name: 'AstGrep' },
    label: 'AstGrep',
    description: 'Structural code search via AST patterns (ast-grep).',
    setIds: ['code-intelligence'],
    declaredReadOnly: true,
    mutatesWorkspace: false,
    requiresNetwork: false,
    requiresUserInteraction: false,
    riskLevel: 'low',
  },
  AstEdit: {
    ref: { source: 'builtin', name: 'AstEdit' },
    label: 'AstEdit',
    description: 'Structural code rewrite via AST patterns (ast-grep) with dry-run preview.',
    setIds: ['code-intelligence'],
    declaredReadOnly: false,
    mutatesWorkspace: true,
    requiresNetwork: false,
    requiresUserInteraction: false,
    riskLevel: 'medium',
  },
  EnterWorktree: {
    ref: { source: 'builtin', name: 'EnterWorktree' },
    label: 'EnterWorktree',
    description: 'Create an isolated git worktree and switch the session to it.',
    setIds: ['tasks'],
    declaredReadOnly: false,
    mutatesWorkspace: true,
    requiresNetwork: false,
    requiresUserInteraction: false,
    riskLevel: 'medium',
  },
  ExitWorktree: {
    ref: { source: 'builtin', name: 'ExitWorktree' },
    label: 'ExitWorktree',
    description: 'Leave the current git worktree and switch back to the project root.',
    setIds: ['tasks'],
    declaredReadOnly: false,
    mutatesWorkspace: true,
    requiresNetwork: false,
    requiresUserInteraction: false,
    riskLevel: 'medium',
  },
  EnterPlanMode: {
    ref: { source: 'builtin', name: 'EnterPlanMode' },
    label: 'EnterPlanMode',
    description: 'Switch the session into read-only plan mode.',
    setIds: ['core-coding'],
    declaredReadOnly: true,
    mutatesWorkspace: false,
    requiresNetwork: false,
    requiresUserInteraction: false,
    riskLevel: 'low',
  },
  ExitPlanMode: {
    ref: { source: 'builtin', name: 'ExitPlanMode' },
    label: 'ExitPlanMode',
    description: 'Leave plan mode (optionally presenting a plan for approval) and resume execution.',
    setIds: ['core-coding'],
    declaredReadOnly: true,
    mutatesWorkspace: false,
    requiresNetwork: false,
    requiresUserInteraction: true,
    riskLevel: 'low',
  },
  Memory: {
    ref: { source: 'builtin', name: 'Memory' },
    label: 'Memory',
    description: 'Read and maintain persistent project memory files under /memories (survives across sessions).',
    setIds: ['core-coding'],
    declaredReadOnly: false,
    mutatesWorkspace: false,
    requiresNetwork: false,
    requiresUserInteraction: false,
    riskLevel: 'low',
  },
};

export const BUILTIN_TOOL_SETS = {
  'core-coding': {
    id: 'core-coding',
    label: 'Core Coding',
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Eval', 'Grep', 'Glob', 'LS', 'EnterPlanMode', 'ExitPlanMode', 'Memory'],
  },
  interaction: {
    id: 'interaction',
    label: 'Interaction',
    tools: ['TodoWrite', 'AskUserQuestion'],
  },
  web: {
    id: 'web',
    label: 'Web',
    tools: ['WebFetch', 'WebSearch'],
  },
  'mcp-control': {
    id: 'mcp-control',
    label: 'MCP Control',
    tools: ['ToolSearch', 'MCPTool', 'ListMcpResources', 'ReadMcpResource'],
  },
  tasks: {
    id: 'tasks',
    label: 'Tasks',
    tools: ['Agent', 'TaskOutput', 'Monitor', 'EnterWorktree', 'ExitWorktree'],
  },
  'code-intelligence': {
    id: 'code-intelligence',
    label: 'Code Intelligence',
    tools: ['LSPTool', 'AstGrep', 'AstEdit'],
  },
  'all-builtin': {
    id: 'all-builtin',
    label: 'All Built-in Tools',
    tools: [...ALL_TOOL_NAMES],
  },
} as const satisfies Readonly<Record<string, { id: string; label: string; tools: readonly ToolName[] }>>;

export type BuiltinToolSetId = keyof typeof BUILTIN_TOOL_SETS;

export const defaultToolSelection: ToolSelection = {
  sets: [{ source: 'builtin', id: 'core-coding' }],
  providers: [],
  include: [],
  exclude: [],
};

export function isToolName(s: string): s is ToolName {
  return (ALL_TOOL_NAMES as readonly string[]).includes(s);
}

export function normalizeToolName(s: string): ToolName | undefined {
  if (isToolName(s)) return s;
  return LEGACY_TOOL_NAME_ALIASES[s];
}

export function isReadOnlyTool(name: ToolName): boolean {
  return READ_ONLY_TOOL_NAMES.includes(name);
}

export function builtinToolRef(name: ToolName): BuiltinToolRef {
  return { source: 'builtin', name };
}

export function toolRefKey(ref: ToolRef): string {
  switch (ref.source) {
    case 'builtin':
      return `builtin:${ref.name}`;
    case 'plugin':
      return `plugin:${ref.pluginId}/${ref.toolId}`;
    case 'mcp':
      return `mcp:${ref.server}/${ref.tool}`;
    case 'mcp-resource':
      return `mcp-resource:${ref.server}/${ref.uri}`;
    case 'mcp-prompt':
      return `mcp-prompt:${ref.server}/${ref.name}`;
    case 'interaction':
      return `interaction:${ref.toolId}`;
  }
}

export function legacyEnabledToolsToSelection(tools: string[]): ToolSelection {
  const include = tools.flatMap((tool) => {
    const name = normalizeToolName(tool);
    return name ? [builtinToolRef(name)] : [];
  });
  return { sets: [], providers: [], include: uniqueToolRefs(include), exclude: [] };
}

function uniqueToolRefs(refs: ToolRef[]): ToolRef[] {
  const seen = new Set<string>();
  const result: ToolRef[] = [];
  for (const ref of refs) {
    const key = toolRefKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

function expandToolSet(set: ToolSetRef): ToolRef[] {
  if (set.source !== 'builtin') return [];
  const builtinSet = BUILTIN_TOOL_SETS[set.id];
  return builtinSet ? builtinSet.tools.map(builtinToolRef) : [];
}

export function resolveToolSelection(selection: ToolSelection): ResolvedToolSelection {
  const expanded = (selection.sets ?? []).flatMap(expandToolSet);
  const excluded = new Set((selection.exclude ?? []).map(toolRefKey));
  const refs = uniqueToolRefs([...expanded, ...(selection.include ?? [])])
    .filter((ref) => !excluded.has(toolRefKey(ref)));
  return {
    refs,
    builtinTools: refs.flatMap((ref) => ref.source === 'builtin' ? [ref.name] : []),
  };
}

export function getEffectiveReadOnly(
  metadata: ToolMetadata,
  options: { pluginTrust?: PluginTrustLevel } = {},
): boolean {
  if (metadata.mutatesWorkspace || metadata.riskLevel === 'high') return false;
  if (!metadata.declaredReadOnly) return false;
  if (metadata.ref.source !== 'plugin') return true;
  return options.pluginTrust === 'trusted' || options.pluginTrust === 'verified';
}
