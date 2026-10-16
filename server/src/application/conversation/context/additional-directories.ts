/**
 * System-prompt fragment telling the agent about the project's additional
 * directories. Returns nothing when there are none, so projects without them
 * keep a byte-identical prompt (and prompt-cache prefix).
 */
export function buildAdditionalDirectoriesPrompt(
  roots: readonly string[] | undefined
): string | undefined {
  if (!roots || roots.length === 0) return undefined;
  return [
    'Additional directories (read/write allowed):',
    ...roots.map(root => `- ${root}`),
    'Relative paths are relative to the primary working directory. Use absolute paths to access the directories above. They are not part of the git repository status shown for the primary working directory.',
  ].join('\n');
}
