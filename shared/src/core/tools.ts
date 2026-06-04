export const ALL_TOOL_NAMES = [
  'read',
  'write',
  'edit',
  'bash',
  'grep',
  'find',
  'ls',
] as const;

export type ToolName = typeof ALL_TOOL_NAMES[number];

/**
 * Tools that do not modify state — safe to expose in Plan mode.
 * write / edit mutate files. bash can execute anything (including writes).
 */
export const READ_ONLY_TOOL_NAMES: ReadonlyArray<ToolName> = ['read', 'grep', 'find', 'ls'];

export function isToolName(s: string): s is ToolName {
  return (ALL_TOOL_NAMES as readonly string[]).includes(s);
}

export function isReadOnlyTool(name: ToolName): boolean {
  return READ_ONLY_TOOL_NAMES.includes(name);
}
