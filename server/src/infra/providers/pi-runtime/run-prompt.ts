export const PLAN_MODE_SYSTEM_PROMPT_SUFFIX =
  '\n\nYou are in PLAN mode. Produce a concrete plan for the user to review and approve. ' +
  'Do not modify files or execute side-effecting commands; only read-only or clarification tools are available. ' +
  'Once the plan is ready, end your turn and wait for the user to confirm before executing anything.';

export interface PiRunPromptBundle {
  effectiveSystemPrompt: string;
  snapshotSystemPromptText: string;
  snapshotSkillCatalogText: string;
}

/**
 * Render the currently-connected MCP servers' instructions as a system-prompt
 * block. Route C: the context tree no longer carries the old delta-in-history
 * MCP notices, so the model would otherwise never see MCP server instructions.
 * Injecting the CURRENT full set each turn (rather than a one-time delta) is
 * also compaction-robust — a delta message can be summarized away once it falls
 * before a compaction boundary; the system prompt never is. Returns '' when no
 * connected server has instructions, so a stable (no-MCP) prompt prefix is
 * unchanged and stays cache-friendly.
 */
export function formatMcpInstructionsForPrompt(
  sources: Array<{ name: string; instructions: string }>,
): string {
  const usable = sources.filter((s) => s.instructions?.trim());
  if (usable.length === 0) return '';
  const sections = usable.map((s) => `## ${s.name}\n${s.instructions.trim()}`);
  return [
    '# MCP Server Instructions',
    'The following MCP servers have provided instructions for how to use their tools and resources:',
    ...sections,
  ].join('\n\n');
}

export function buildPiRunPrompt(input: {
  systemPrompt?: string;
  externalProviderCatalog: string;
  skillCatalog: string;
  activeSkillContext: string;
  isPlanMode: boolean;
  mcpInstructions?: string;
}): PiRunPromptBundle {
  const { systemPrompt, externalProviderCatalog, skillCatalog, activeSkillContext, isPlanMode, mcpInstructions } = input;
  const baseSystemPrompt = [
    systemPrompt ?? '',
    externalProviderCatalog
      ? `\n\n${externalProviderCatalog}\nUse SearchExternalTools and InspectExternalTool before loading external tools. LoadExternalTool only makes a tool available in this session; execution may still require permission.`
      : '',
    skillCatalog
      ? `\n\n${skillCatalog}`
      : '',
    activeSkillContext
      ? `\n\n${activeSkillContext}`
      : '',
    mcpInstructions
      ? `\n\n${mcpInstructions}`
      : '',
  ].join('');
  const effectiveSystemPrompt = isPlanMode
    ? baseSystemPrompt + PLAN_MODE_SYSTEM_PROMPT_SUFFIX
    : baseSystemPrompt;

  return {
    effectiveSystemPrompt,
    snapshotSystemPromptText: (systemPrompt ?? '')
      + externalProviderCatalog
      + (mcpInstructions ? `\n\n${mcpInstructions}` : '')
      + (isPlanMode ? PLAN_MODE_SYSTEM_PROMPT_SUFFIX : ''),
    snapshotSkillCatalogText: skillCatalog + activeSkillContext,
  };
}
