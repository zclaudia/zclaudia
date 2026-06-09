import { randomUUID } from 'node:crypto';
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import type Database from 'better-sqlite3';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type {
  SkillExecutionMode as SharedSkillExecutionMode,
  SkillExecutionOverride,
  SkillForkToolPolicy,
} from '@zclaudia/shared/core/skills';
import { ALL_TOOL_NAMES, type ToolName } from '@zclaudia/shared/core/tools';
import {
  type DiscoveredSkill,
  type SkillRef,
  loadDiscoveredSkillContent,
} from '../../../application/plugins/skill-tools.js';
import type { PermissionCallback } from '../message-types.js';
import { buildModel } from './build-model.js';
import { buildTools } from './tool-bridge.js';

type ToolContent = Array<{ type: 'text'; text: string }>;

export type SkillExecutionMode = 'inline' | 'fork';

export interface SkillExecutionPolicy {
  modes: SkillExecutionMode[];
  defaultMode: SkillExecutionMode;
  source: 'profile-override' | 'skill-metadata' | 'source-default' | 'heuristic' | 'override';
  reason: string;
  forkToolPolicy?: SkillForkToolPolicy;
  diagnostics?: string[];
}

export interface SkillRuntimeState {
  discoverableSkills: DiscoveredSkill[];
  pinnedSkills: SkillRef[];
  loadedSkills: SkillRef[];
  loadedSkillContents: Record<string, string>;
}

export interface SkillRuntimeOptions {
  state: SkillRuntimeState;
  execution?: SkillExecutionDependencies;
}

type NestedAgentLike = {
  subscribe(listener: (event: unknown) => void): () => void;
  prompt(input: string): Promise<void>;
};

export interface SkillExecutionDependencies {
  cwd: string;
  db?: Database.Database;
  enabledTools?: string[];
  llmProfileConfig?: LlmProfileConfig;
  agentProfile?: AgentProfileConfig;
  permissionOverride?: unknown;
  permissionCallback?: PermissionCallback;
  agentFactory?: (opts: Record<string, unknown>) => NestedAgentLike;
}

function textResult(
  text: string,
  details: Record<string, unknown> = {},
): { content: ToolContent; details: Record<string, unknown> } {
  return { content: [{ type: 'text', text }], details };
}

function jsonResult(value: Record<string, unknown>, details: Record<string, unknown> = {}) {
  return textResult(JSON.stringify(value, null, 2), details);
}

export function skillRefKey(ref: SkillRef): string {
  return `${ref.source}:${ref.id}`;
}

function isLoaded(state: SkillRuntimeState, ref: SkillRef): boolean {
  const key = skillRefKey(ref);
  return state.loadedSkills.some((loaded) => skillRefKey(loaded) === key);
}

function findSkill(state: SkillRuntimeState, ref: SkillRef): DiscoveredSkill | undefined {
  return state.discoverableSkills.find((skill) => skill.source === ref.source && skill.id === ref.id);
}

function normalizeSkillRef(input: unknown): SkillRef | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const row = input as Record<string, unknown>;
  if (
    (row.source === 'workspace' || row.source === 'external' || row.source === 'plugin')
    && typeof row.id === 'string'
    && row.id.trim()
  ) {
    return { source: row.source, id: row.id.trim() };
  }
  return undefined;
}

export function createSkillRuntimeState(discoverableSkills: DiscoveredSkill[], pinnedSkills: SkillRef[] = []): SkillRuntimeState {
  return {
    discoverableSkills,
    pinnedSkills,
    loadedSkills: [...pinnedSkills],
    loadedSkillContents: {},
  };
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

function keywordMatch(skill: DiscoveredSkill, keywords: string[]): string | undefined {
  const haystack = `${skill.id} ${skill.name} ${skill.description}`.toLowerCase();
  return keywords.find((keyword) => haystack.includes(keyword));
}

export function resolveSkillExecutionPolicy(
  skill: DiscoveredSkill,
  contentStats?: { estimatedTokens?: number; contentLength?: number },
  agentProfile?: AgentProfileConfig,
): SkillExecutionPolicy {
  const basePolicy = resolveBaseSkillExecutionPolicy(skill, contentStats);
  const metadataPolicy = applySkillPolicyLayer(
    basePolicy,
    skill.execution,
    'skill-metadata',
    'Skill execution metadata from SKILL.md frontmatter.',
  );
  const override = findSkillExecutionOverride(agentProfile, skill);
  return applySkillPolicyLayer(
    metadataPolicy,
    override,
    'profile-override',
    'Agent profile skillExecution override.',
  );
}

function resolveBaseSkillExecutionPolicy(
  skill: DiscoveredSkill,
  contentStats?: { estimatedTokens?: number; contentLength?: number },
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
      reason: 'Workspace skills default to inline context unless they look like task/report workflows.',
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
  skill: DiscoveredSkill,
): SkillExecutionOverride | undefined {
  return agentProfile?.skillExecution?.overrides?.find((override) =>
    override.ref.source === skill.source && override.ref.id === skill.id);
}

function applySkillPolicyLayer(
  base: SkillExecutionPolicy,
  layer: {
    allowedModes?: readonly SharedSkillExecutionMode[];
    defaultMode?: SharedSkillExecutionMode;
    forkToolPolicy?: SkillForkToolPolicy;
  } | undefined,
  source: SkillExecutionPolicy['source'],
  reason: string,
): SkillExecutionPolicy {
  if (!layer) return base;
  const diagnostics = [...(base.diagnostics ?? [])];
  const requestedModes = layer.allowedModes && layer.allowedModes.length > 0
    ? layer.allowedModes
    : base.modes;
  let modes = requestedModes.filter((mode): mode is SkillExecutionMode =>
    (mode === 'inline' || mode === 'fork') && base.modes.includes(mode));

  if (modes.length !== requestedModes.length) {
    diagnostics.push(`${source.replaceAll('-', '_')}_cannot_expand_modes`);
  }
  if (modes.length === 0) {
    modes = [...base.modes];
  }

  let defaultMode = (layer.defaultMode === 'inline' || layer.defaultMode === 'fork'
    ? layer.defaultMode
    : base.defaultMode) as SkillExecutionMode;
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

export function buildSkillCatalog(state: SkillRuntimeState, agentProfile?: AgentProfileConfig): string {
  if (state.discoverableSkills.length === 0) return '';
  const rows = state.discoverableSkills.map((skill) => {
    const loaded = isLoaded(state, { source: skill.source, id: skill.id }) ? ', loaded=true' : '';
    const policy = resolveSkillExecutionPolicy(skill, undefined, agentProfile);
    return `- ${skill.source}/${skill.id}: ${skill.name} — ${skill.description || 'No description'}; defaultMode=${policy.defaultMode}, modes=${policy.modes.join('|')}, policySource=${policy.source}${loaded}`;
  });
  return `Discoverable skills:\n${rows.join('\n')}\nUse SearchSkills and InspectSkill before choosing a skill. Use LoadSkill for inline behavioral context and RunSkill for isolated task execution.`;
}

export function buildActiveSkillContext(state: SkillRuntimeState): string {
  const loaded = state.loadedSkills
    .map((ref) => {
      const content = state.loadedSkillContents[skillRefKey(ref)];
      if (!content) return undefined;
      return { ref, content };
    })
    .filter((entry): entry is { ref: SkillRef; content: string } => Boolean(entry))
    .sort((a, b) => skillRefKey(a.ref).localeCompare(skillRefKey(b.ref)));

  if (loaded.length === 0) return '';

  return [
    'Active session skills:',
    ...loaded.map(({ ref, content }) => [
      `<skill source="${ref.source}" id="${ref.id}">`,
      content.trim(),
      '</skill>',
    ].join('\n')),
  ].join('\n\n');
}

function skillSummary(state: SkillRuntimeState, skill: DiscoveredSkill, agentProfile?: AgentProfileConfig): Record<string, unknown> {
  const ref: SkillRef = { source: skill.source, id: skill.id };
  return {
    ref,
    id: skill.id,
    name: skill.name,
    description: skill.description,
    source: skill.source,
    loaded: isLoaded(state, ref),
    executionPolicy: resolveSkillExecutionPolicy(skill, undefined, agentProfile),
  };
}

async function loadSkill(state: SkillRuntimeState, ref: SkillRef, agentProfile?: AgentProfileConfig) {
  const skill = findSkill(state, ref);
  if (!skill) {
    return textResult(`Skill not found or not eligible: ${ref.source}/${ref.id}`, {
      ok: false,
      error: 'skill_not_found',
      ref,
    });
  }

  const policy = resolveSkillExecutionPolicy(skill, undefined, agentProfile);
  if (!policy.modes.includes('inline')) {
    return jsonResult({
      ok: false,
      error: 'policy_denied_inline',
      ref,
      executionPolicy: policy,
      message: 'This skill does not allow inline loading. Use RunSkill when fork execution is allowed.',
    }, { ok: false, error: 'policy_denied_inline', ref });
  }

  const content = await loadDiscoveredSkillContent(ref);
  if (!content) {
    return textResult(`Skill content unavailable: ${ref.source}/${ref.id}`, {
      ok: false,
      error: 'skill_content_unavailable',
      ref,
    });
  }

  const key = skillRefKey(ref);
  state.loadedSkillContents[key] = content;
  if (!isLoaded(state, ref)) {
    state.loadedSkills.push(ref);
    state.loadedSkills.sort((a, b) => skillRefKey(a).localeCompare(skillRefKey(b)));
  }

  return textResult(JSON.stringify({
    loaded: true,
    ref,
    name: skill.name,
    availability: 'next_model_request',
    message: 'Skill loaded for this session. Its full SKILL.md content will be injected as active skill context on the next assistant step.',
  }, null, 2), { ok: true, ref });
}

const READ_ONLY_SKILL_TOOLS: ToolName[] = ['Read', 'Grep', 'Glob', 'LS', 'Find'];
const WEB_SKILL_TOOLS: ToolName[] = ['WebFetch', 'WebSearch'];
const WORKSPACE_EDIT_SKILL_TOOLS: ToolName[] = ['Write', 'Edit'];
const AGENT_DEFAULT_EXCLUDED_TOOLS = new Set<ToolName>([
  'Agent',
  'MCPTool',
  'Monitor',
  'TaskOutput',
  'ToolSearch',
  'AskUserQuestion',
]);
const ALL_TOOL_NAME_SET = new Set<string>(ALL_TOOL_NAMES);

function isToolName(value: string): value is ToolName {
  return ALL_TOOL_NAME_SET.has(value);
}

function extractAssistantText(messages: unknown): string {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as Record<string, unknown>;
    const role = message.role ?? message.type;
    if (role !== 'assistant') continue;
    const content = message.content;
    if (typeof content === 'string') return content.trim();
    if (!Array.isArray(content)) continue;
    const text = content
      .map((block) => {
        if (!block || typeof block !== 'object') return '';
        const row = block as Record<string, unknown>;
        return typeof row.text === 'string' ? row.text : '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
    if (text) return text;
  }
  return '';
}

function buildForkSystemPrompt(ref: SkillRef, content: string): string {
  return [
    'You are executing the following skill as an isolated worker for a parent agent.',
    '',
    `<skill source="${ref.source}" id="${ref.id}">`,
    content.trim(),
    '</skill>',
    '',
    'Complete the user task using this skill.',
    'Return a concise result for the parent agent.',
    'Do not assume your intermediate messages are visible to the parent.',
    'Do not modify files unless a future policy explicitly grants write access.',
  ].join('\n');
}

function resolveForkSkillToolNames(
  execution: SkillExecutionDependencies,
  policy: SkillExecutionPolicy,
): ToolName[] {
  const parentEnabled = new Set((execution.enabledTools ?? READ_ONLY_SKILL_TOOLS).map(String));
  const forkToolPolicy = policy.forkToolPolicy ?? 'read-only';
  const candidates = (() => {
    if (forkToolPolicy === 'web') return [...READ_ONLY_SKILL_TOOLS, ...WEB_SKILL_TOOLS];
    if (forkToolPolicy === 'workspace-edit') return [...READ_ONLY_SKILL_TOOLS, ...WORKSPACE_EDIT_SKILL_TOOLS];
    if (forkToolPolicy === 'agent-default') {
      return (execution.enabledTools ?? READ_ONLY_SKILL_TOOLS)
        .filter(isToolName)
        .filter((tool) => !AGENT_DEFAULT_EXCLUDED_TOOLS.has(tool));
    }
    return READ_ONLY_SKILL_TOOLS;
  })();
  return [...new Set(candidates)].filter((tool) => parentEnabled.has(tool));
}

function buildForkSkillTools(
  execution: SkillExecutionDependencies,
  policy: SkillExecutionPolicy,
): AgentTool<any>[] {
  const enabled = resolveForkSkillToolNames(execution, policy);
  return buildTools(execution.cwd, {
    enabled,
    db: execution.db,
    permissionOverride: execution.permissionOverride as any,
    permissionCallback: execution.permissionCallback,
  });
}

async function executeForkedSkill(
  ref: SkillRef,
  skillContent: string,
  task: string,
  execution: SkillExecutionDependencies,
  policy: SkillExecutionPolicy,
): Promise<{ ok: true; result: string } | { ok: false; error: string; message: string }> {
  const builtModel = buildModel(execution.llmProfileConfig, execution.agentProfile?.model);
  const agentFactory = execution.agentFactory ?? ((opts: Record<string, unknown>) => new Agent(opts as any));
  const finalMessages: unknown[] = [];
  const agent = agentFactory({
    initialState: {
      systemPrompt: buildForkSystemPrompt(ref, skillContent),
      model: builtModel.model,
      messages: [],
      tools: buildForkSkillTools(execution, policy),
    },
    ...(builtModel.getApiKey ? { getApiKey: builtModel.getApiKey } : {}),
  });
  const unsubscribe = agent.subscribe((event: unknown) => {
    const row = event as Record<string, unknown>;
    if (row.type === 'agent_end') {
      finalMessages.splice(0, finalMessages.length, ...((Array.isArray(row.messages) ? row.messages : []) as unknown[]));
    }
  });
  try {
    await agent.prompt(`Task:\n${task}`);
  } catch (err) {
    return {
      ok: false,
      error: 'skill_execution_failed',
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    unsubscribe();
  }

  const result = extractAssistantText(finalMessages);
  if (!result) {
    return {
      ok: false,
      error: 'empty_skill_result',
      message: 'Forked skill execution completed without an assistant text result.',
    };
  }
  return { ok: true, result };
}

async function runSkill(state: SkillRuntimeState, params: unknown, execution?: SkillExecutionDependencies) {
  const args = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
  const ref = normalizeSkillRef(args.ref);
  if (!ref) {
    return jsonResult({
      ok: false,
      error: 'invalid_ref',
      message: 'RunSkill requires a valid skill ref.',
    }, { ok: false, error: 'invalid_ref' });
  }

  const task = typeof args.task === 'string' ? args.task.trim() : '';
  if (!task) {
    return jsonResult({
      ok: false,
      error: 'missing_task',
      ref,
      message: 'RunSkill requires a non-empty task.',
    }, { ok: false, error: 'missing_task', ref });
  }

  const requestedMode = typeof args.mode === 'string' ? args.mode : undefined;
  if (requestedMode === 'inline') {
    return jsonResult({
      ok: false,
      error: 'inline_mode_not_supported',
      ref,
      message: 'RunSkill is fork-only in Phase 2A. Use LoadSkill to add a skill as inline active context.',
    }, { ok: false, error: 'inline_mode_not_supported', ref });
  }
  if (requestedMode !== undefined && requestedMode !== 'fork') {
    return jsonResult({
      ok: false,
      error: 'invalid_mode',
      ref,
      mode: requestedMode,
      message: 'RunSkill mode must be "fork" when provided.',
    }, { ok: false, error: 'invalid_mode', ref });
  }

  const skill = findSkill(state, ref);
  if (!skill) {
    return jsonResult({
      ok: false,
      error: 'skill_not_found',
      ref,
      message: `Skill not found or not eligible: ${ref.source}/${ref.id}`,
    }, { ok: false, error: 'skill_not_found', ref });
  }

  const executionId = `skill-${randomUUID()}`;
  const startedAt = Date.now();
  const policy = resolveSkillExecutionPolicy(skill, undefined, execution?.agentProfile);
  const forkToolPolicy = policy.forkToolPolicy ?? 'read-only';
  const enabledForkTools = execution ? resolveForkSkillToolNames(execution, policy) : [];
  const diagnostics = () => ({
    executionId,
    durationMs: Date.now() - startedAt,
    forkToolPolicy,
    enabledForkTools,
  });
  if (!policy.modes.includes('fork')) {
    return jsonResult({
      ok: false,
      error: 'policy_denied_fork',
      ref,
      mode: 'fork',
      executionPolicy: policy,
      ...diagnostics(),
      message: 'This skill does not allow fork execution.',
    }, { ok: false, error: 'policy_denied_fork', ref });
  }

  if (requestedMode === undefined && policy.defaultMode === 'inline') {
    return jsonResult({
      ok: false,
      error: 'use_load_skill',
      ref,
      executionPolicy: policy,
      ...diagnostics(),
      message: 'This skill defaults to inline active context. Use LoadSkill, or call RunSkill with mode: "fork" if fork execution is intentional.',
    }, { ok: false, error: 'use_load_skill', ref });
  }

  const content = await loadDiscoveredSkillContent(ref);
  if (!content) {
    return jsonResult({
      ok: false,
      error: 'skill_content_unavailable',
      ref,
      executionPolicy: policy,
      ...diagnostics(),
      message: `Skill content unavailable: ${ref.source}/${ref.id}`,
    }, { ok: false, error: 'skill_content_unavailable', ref });
  }

  if (execution) {
    const result = await executeForkedSkill(ref, content, task, execution, policy);
    if (result.ok) {
      return jsonResult({
        ok: true,
        ref,
        mode: 'fork',
        result: result.result,
        executionPolicy: policy,
        ...diagnostics(),
      }, { ok: true, ref, mode: 'fork' });
    }
    return jsonResult({
      ok: false,
      error: result.error,
      ref,
      mode: 'fork',
      message: result.message,
      executionPolicy: policy,
      ...diagnostics(),
    }, { ok: false, error: result.error, ref });
  }

  return jsonResult({
    ok: false,
    error: 'skill_execution_unavailable',
    ref,
    mode: 'fork',
    executionPolicy: policy,
    ...diagnostics(),
    message: 'RunSkill fork execution dependencies are not configured.',
  }, { ok: false, error: 'skill_execution_unavailable', ref });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildSkillMetaTools(options: SkillRuntimeOptions): AgentTool<any>[] {
  const { state, execution } = options;
  return [
    {
      name: 'ListSkills',
      label: 'ListSkills',
      description: 'List skills that are discoverable and can be loaded as active session context.',
      parameters: { type: 'object', properties: {} } as any,
      execute: async () => textResult(JSON.stringify({
        skills: state.discoverableSkills.map((skill) => skillSummary(state, skill, execution?.agentProfile)),
      }, null, 2), { ok: true, count: state.discoverableSkills.length }),
    },
    {
      name: 'SearchSkills',
      label: 'SearchSkills',
      description: 'Search discoverable skills by id, name, source, or description before loading full skill context.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number', default: 10 },
        },
      } as any,
      execute: async (_id: string, params: unknown) => {
        const args = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
        const query = String(args.query ?? '').trim().toLowerCase();
        const limit = Math.max(1, Math.min(Number(args.limit ?? 10) || 10, 50));
        const results = state.discoverableSkills
          .filter((skill) => {
            if (!query) return true;
            const haystack = `${skill.id} ${skill.name} ${skill.description} ${skill.source}`.toLowerCase();
            return haystack.includes(query);
          })
          .slice(0, limit)
          .map((skill) => skillSummary(state, skill, execution?.agentProfile));
        return textResult(JSON.stringify({ results }, null, 2), { ok: true, total: results.length });
      },
    },
    {
      name: 'InspectSkill',
      label: 'InspectSkill',
      description: 'Inspect one skill metadata entry without loading its full SKILL.md body.',
      parameters: { type: 'object', properties: { ref: { type: 'object' } }, required: ['ref'] } as any,
      execute: async (_id: string, params: unknown) => {
        const ref = normalizeSkillRef((params as { ref?: unknown })?.ref);
        if (!ref) return textResult('InspectSkill requires a valid skill ref', { ok: false, error: 'invalid_ref' });
        const skill = findSkill(state, ref);
        if (!skill) return textResult(`Skill not found or not eligible: ${ref.source}/${ref.id}`, { ok: false, error: 'skill_not_found', ref });
        return textResult(JSON.stringify({
          ...skillSummary(state, skill, execution?.agentProfile),
          filePath: skill.filePath,
          dirPath: skill.dirPath,
          contentLoaded: Boolean(state.loadedSkillContents[skillRefKey(ref)]),
        }, null, 2), { ok: true, ref });
      },
    },
    {
      name: 'LoadSkill',
      label: 'LoadSkill',
      description: 'Load one skill for this session so its full SKILL.md becomes inline active context on the next assistant step.',
      parameters: { type: 'object', properties: { ref: { type: 'object' } }, required: ['ref'] } as any,
      execute: async (_id: string, params: unknown) => {
        const ref = normalizeSkillRef((params as { ref?: unknown })?.ref);
        if (!ref) return textResult('LoadSkill requires a valid skill ref', { ok: false, error: 'invalid_ref' });
        return loadSkill(state, ref, execution?.agentProfile);
      },
    },
    {
      name: 'RunSkill',
      label: 'RunSkill',
      description: 'Execute a fork-capable skill once as an isolated worker and return its result without changing active skill context.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'object' },
          task: { type: 'string' },
          mode: { type: 'string', enum: ['fork', 'inline'] },
        },
        required: ['ref', 'task'],
      } as any,
      execute: async (_id: string, params: unknown) => runSkill(state, params, execution),
    },
  ] as AgentTool<any>[];
}
