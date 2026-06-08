export const ALL_TOOL_NAMES = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Grep',
  'Find',
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
  'Agent',
  'LSPTool',
] as const;

export type ToolName = typeof ALL_TOOL_NAMES[number];

export const LEGACY_TOOL_NAME_ALIASES: Readonly<Record<string, ToolName>> = {
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  bash: 'Bash',
  grep: 'Grep',
  find: 'Find',
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
  'Find',
  'Glob',
  'LS',
  'TodoWrite',
  'AskUserQuestion',
  'WebFetch',
  'WebSearch',
  'ToolSearch',
  'ListMcpResources',
  'ReadMcpResource',
  'LSPTool',
];

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
