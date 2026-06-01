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

export function isToolName(s: string): s is ToolName {
  return (ALL_TOOL_NAMES as readonly string[]).includes(s);
}
