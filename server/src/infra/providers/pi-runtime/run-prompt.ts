export const PLAN_MODE_SYSTEM_PROMPT_SUFFIX =
  '\n\nYou are in PLAN mode. Produce a concrete plan for the user to review and approve. ' +
  'Do not modify files or execute side-effecting commands; only read-only or clarification tools are available. ' +
  'Once the plan is ready, end your turn and wait for the user to confirm before executing anything.';

export interface PiRunPromptBundle {
  effectiveSystemPrompt: string;
  snapshotSystemPromptText: string;
  snapshotSkillCatalogText: string;
}

export function buildPiRunPrompt(input: {
  systemPrompt?: string;
  externalProviderCatalog: string;
  skillCatalog: string;
  activeSkillContext: string;
  isPlanMode: boolean;
}): PiRunPromptBundle {
  const { systemPrompt, externalProviderCatalog, skillCatalog, activeSkillContext, isPlanMode } = input;
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
  ].join('');
  const effectiveSystemPrompt = isPlanMode
    ? baseSystemPrompt + PLAN_MODE_SYSTEM_PROMPT_SUFFIX
    : baseSystemPrompt;

  return {
    effectiveSystemPrompt,
    snapshotSystemPromptText: (systemPrompt ?? '')
      + externalProviderCatalog
      + (isPlanMode ? PLAN_MODE_SYSTEM_PROMPT_SUFFIX : ''),
    snapshotSkillCatalogText: skillCatalog + activeSkillContext,
  };
}
