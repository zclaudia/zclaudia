import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type {
  SkillRef,
  SkillExecutionMode as SharedSkillExecutionMode,
  SkillExecutionOverride,
  SkillForkToolPolicy,
} from '@zclaudia/shared/core/skills';
import type { RuntimeDiscoveredSkill, SkillExecutionMode, SkillRuntimeState } from './skills.js';

export interface SkillExecutionPolicy {
  modes: SkillExecutionMode[];
  defaultMode: SkillExecutionMode;
  source: 'profile-override' | 'skill-metadata' | 'source-default' | 'heuristic' | 'override';
  reason: string;
  forkToolPolicy?: SkillForkToolPolicy;
  diagnostics?: string[];
}

export function skillRefKey(ref: SkillRef): string {
  return `${ref.source}:${ref.id}`;
}

export function isLoaded(state: SkillRuntimeState, ref: SkillRef): boolean {
  const key = skillRefKey(ref);
  return state.loadedSkills.some(loaded => skillRefKey(loaded) === key);
}

const FORK_KEYWORDS = [
  'review',
  'audit',
  'analyze',
  'analyse',
  'generate',
  'investigate',
  'search',
  'summarize',
  'summarise',
  'report',
];

const INLINE_KEYWORDS = [
  'guideline',
  'convention',
  'workflow',
  'follow',
  'use when',
  'rule',
  'standard',
];

function keywordMatch(skill: RuntimeDiscoveredSkill, keywords: string[]): string | undefined {
  const haystack =
    `${skill.id} ${skill.name} ${skill.description} ${skill.metadata?.whenToUse ?? ''}`.toLowerCase();
  return keywords.find(keyword => haystack.includes(keyword));
}

export function resolveSkillExecutionPolicy(
  skill: RuntimeDiscoveredSkill,
  contentStats?: { estimatedTokens?: number; contentLength?: number },
  agentProfile?: AgentProfileConfig
): SkillExecutionPolicy {
  const basePolicy = resolveBaseSkillExecutionPolicy(skill, contentStats);
  const metadataPolicy = applySkillPolicyLayer(
    basePolicy,
    skill.execution,
    'skill-metadata',
    'Skill execution metadata from SKILL.md frontmatter.'
  );
  const override = findSkillExecutionOverride(agentProfile, skill);
  return applySkillPolicyLayer(
    metadataPolicy,
    override,
    'profile-override',
    'Agent profile skillExecution override.'
  );
}

function resolveBaseSkillExecutionPolicy(
  skill: RuntimeDiscoveredSkill,
  contentStats?: { estimatedTokens?: number; contentLength?: number }
): SkillExecutionPolicy {
  if (skill.source === 'plugin') {
    return {
      modes: ['fork'],
      defaultMode: 'fork',
      source: 'source-default',
      reason: 'Plugin skills default to isolated fork execution in Phase 2A.',
    };
  }

  const forkKeyword = keywordMatch(skill, FORK_KEYWORDS);
  if (forkKeyword) {
    return {
      modes: ['inline', 'fork'],
      defaultMode: 'fork',
      source: 'heuristic',
      reason: `Matched task-output keyword "${forkKeyword}".`,
    };
  }

  const estimatedSize = contentStats?.estimatedTokens ?? contentStats?.contentLength;
  if (estimatedSize !== undefined && estimatedSize > 4_000) {
    return {
      modes: ['inline', 'fork'],
      defaultMode: 'fork',
      source: 'heuristic',
      reason: 'Skill content appears large enough to prefer isolated execution.',
    };
  }

  const inlineKeyword = keywordMatch(skill, INLINE_KEYWORDS);
  if (inlineKeyword) {
    return {
      modes: ['inline', 'fork'],
      defaultMode: 'inline',
      source: 'heuristic',
      reason: `Matched behavior-guidance keyword "${inlineKeyword}".`,
    };
  }

  if (skill.source === 'workspace') {
    return {
      modes: ['inline', 'fork'],
      defaultMode: 'inline',
      source: 'source-default',
      reason:
        'Workspace skills default to inline context unless they look like task/report workflows.',
    };
  }

  return {
    modes: ['inline', 'fork'],
    defaultMode: 'fork',
    source: 'heuristic',
    reason: 'No strong guidance signal found; defaulting external skill to isolated execution.',
  };
}

function findSkillExecutionOverride(
  agentProfile: AgentProfileConfig | undefined,
  skill: RuntimeDiscoveredSkill
): SkillExecutionOverride | undefined {
  return agentProfile?.skillExecution?.overrides?.find(
    override => override.ref.source === skill.source && override.ref.id === skill.id
  );
}

function applySkillPolicyLayer(
  base: SkillExecutionPolicy,
  layer:
    | {
        allowedModes?: readonly SharedSkillExecutionMode[];
        defaultMode?: SharedSkillExecutionMode;
        forkToolPolicy?: SkillForkToolPolicy;
      }
    | undefined,
  source: SkillExecutionPolicy['source'],
  reason: string
): SkillExecutionPolicy {
  if (!layer) return base;
  const diagnostics = [...(base.diagnostics ?? [])];
  const requestedModes =
    layer.allowedModes && layer.allowedModes.length > 0 ? layer.allowedModes : base.modes;
  let modes = requestedModes.filter(
    (mode): mode is SkillExecutionMode =>
      (mode === 'inline' || mode === 'fork') && base.modes.includes(mode)
  );

  if (modes.length !== requestedModes.length) {
    diagnostics.push(`${source.replaceAll('-', '_')}_cannot_expand_modes`);
  }
  if (modes.length === 0) {
    modes = [...base.modes];
  }

  let defaultMode = (
    layer.defaultMode === 'inline' || layer.defaultMode === 'fork'
      ? layer.defaultMode
      : base.defaultMode
  ) as SkillExecutionMode;
  if (!modes.includes(defaultMode)) {
    diagnostics.push('default_mode_not_allowed');
    defaultMode = modes[0] ?? base.defaultMode;
  }

  return {
    ...base,
    modes,
    defaultMode,
    source,
    reason,
    ...(layer.forkToolPolicy ? { forkToolPolicy: layer.forkToolPolicy } : {}),
    ...(diagnostics.length > 0 ? { diagnostics: [...new Set(diagnostics)] } : {}),
  };
}

export function buildSkillCatalog(
  state: SkillRuntimeState,
  agentProfile?: AgentProfileConfig
): string {
  if (state.discoverableSkills.length === 0) return '';
  const rows = state.discoverableSkills.map(skill => {
    const loaded = isLoaded(state, { source: skill.source, id: skill.id }) ? ', loaded=true' : '';
    const policy = resolveSkillExecutionPolicy(skill, undefined, agentProfile);
    const whenToUse = skill.metadata?.whenToUse ? `; whenToUse=${skill.metadata.whenToUse}` : '';
    const paths = skill.metadata?.paths?.length ? `; paths=${skill.metadata.paths.join('|')}` : '';
    const args = skill.metadata?.argumentHint
      ? `; args=${skill.metadata.argumentHint}`
      : skill.metadata?.arguments?.length
        ? `; args=${skill.metadata.arguments.join(' ')}`
        : '';
    return `- ${skill.source}/${skill.id}: ${skill.name} — ${skill.description || 'No description'}${whenToUse}${paths}${args}; defaultMode=${policy.defaultMode}, modes=${policy.modes.join('|')}, policySource=${policy.source}${loaded}`;
  });
  return `Discoverable skills:\n${rows.join('\n')}\nUse SearchSkills and InspectSkill before choosing a skill. Use LoadSkill for inline behavioral context and RunSkill for isolated task execution.`;
}
