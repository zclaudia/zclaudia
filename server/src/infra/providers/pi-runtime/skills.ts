import { randomUUID } from 'node:crypto';
import { streamSimple } from '@earendil-works/pi-ai/compat';
import {
  Agent,
  type AgentOptions,
  type AgentTool,
  type StreamFn,
} from '@earendil-works/pi-agent-core';
import type Database from 'better-sqlite3';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { UnifiedPermissionPolicy } from '@zclaudia/shared/interaction/permissions';
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
  recordSkillUsage,
} from '../../../application/plugins/skill-tools.js';
import type { PermissionCallback } from '../message-types.js';
import { buildModel } from './build-model.js';
import { buildTools } from './tool-bridge.js';
import { agentToolParameters, textResult, type ToolContent } from './tool-common.js';
import { wrapStreamFnWithToolSchemaCompat } from './tool-schema-compat.js';

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

export type DirectSkillInvocationResult =
  | { matched: false }
  | {
      matched: true;
      ok: true;
      mode: 'inline';
      ref: SkillRef;
      processedInput: string;
      message: string;
    }
  | {
      matched: true;
      ok: true;
      mode: 'fork';
      ref: SkillRef;
      task: string;
      args: string;
      message: string;
    }
  | {
      matched: true;
      ok: false;
      error: string;
      message: string;
      ref?: SkillRef;
    };

export type PreparedDirectForkSkillInvocation = Extract<
  DirectSkillInvocationResult,
  { matched: true; ok: true; mode: 'fork' }
>;

export type DirectForkSkillExecutionResult =
  | {
      ok: true;
      mode: 'fork';
      ref: SkillRef;
      result: string;
    }
  | {
      ok: false;
      mode: 'fork';
      ref: SkillRef;
      error: string;
      message: string;
    };

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
  permissionOverride?: Partial<UnifiedPermissionPolicy>;
  permissionCallback?: PermissionCallback;
  agentFactory?: (opts: AgentOptions) => NestedAgentLike;
  streamFn?: StreamFn;
  /** Parent run's abort signal: an in-flight fork resolves with an aborted error when it fires. */
  abortSignal?: AbortSignal;
}

// Local variant of tool-common's jsonResult that also passes details through
// (tool-common's returns empty details); textResult itself is shared.
function jsonResult(value: Record<string, unknown>, details: Record<string, unknown> = {}) {
  return textResult(JSON.stringify(value, null, 2), details);
}

export function skillRefKey(ref: SkillRef): string {
  return `${ref.source}:${ref.id}`;
}

function isLoaded(state: SkillRuntimeState, ref: SkillRef): boolean {
  const key = skillRefKey(ref);
  return state.loadedSkills.some(loaded => skillRefKey(loaded) === key);
}

function findSkill(state: SkillRuntimeState, ref: SkillRef): DiscoveredSkill | undefined {
  return state.discoverableSkills.find(skill => skill.source === ref.source && skill.id === ref.id);
}

function findSkillById(state: SkillRuntimeState, id: string): DiscoveredSkill | undefined {
  return state.discoverableSkills.find(skill => skill.id === id || skill.name === id);
}

function normalizeSkillRef(input: unknown): SkillRef | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const row = input as Record<string, unknown>;
  if (
    (row.source === 'workspace' || row.source === 'external' || row.source === 'plugin') &&
    typeof row.id === 'string' &&
    row.id.trim()
  ) {
    return { source: row.source, id: row.id.trim() };
  }
  return undefined;
}

export function createSkillRuntimeState(
  discoverableSkills: DiscoveredSkill[],
  pinnedSkills: SkillRef[] = []
): SkillRuntimeState {
  return {
    discoverableSkills,
    pinnedSkills,
    loadedSkills: [...pinnedSkills],
    loadedSkillContents: {},
  };
}

function parseSkillArguments(args: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(args)) !== null) {
    const token = match[1] ?? match[2] ?? match[3] ?? '';
    tokens.push(token.replace(/\\(["'\\])/g, '$1'));
  }
  return tokens;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function substituteSkillArguments(
  content: string,
  args: string | undefined,
  argumentNames: string[] = []
): string {
  if (args === undefined) return content;
  const parsedArgs = parseSkillArguments(args);
  let out = content;
  for (let i = 0; i < argumentNames.length; i += 1) {
    const name = argumentNames[i];
    if (!name) continue;
    const escaped = escapeRegExp(name);
    out = out
      .replace(new RegExp(`\\$\\{${escaped}\\}`, 'g'), parsedArgs[i] ?? '')
      .replace(new RegExp(`\\$${escaped}(?![\\[\\w])`, 'g'), parsedArgs[i] ?? '');
  }
  out = out.replace(/\$\{ARGUMENTS\}/g, args);
  out = out.replace(
    /\$ARGUMENTS\[(\d+)\]/g,
    (_match, index: string) => parsedArgs[Number(index)] ?? ''
  );
  out = out.replace(/\$(\d+)(?!\w)/g, (_match, index: string) => parsedArgs[Number(index)] ?? '');
  out = out.replace(/\$ARGUMENTS/g, args);
  return out;
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
  const haystack =
    `${skill.id} ${skill.name} ${skill.description} ${skill.metadata?.whenToUse ?? ''}`.toLowerCase();
  return keywords.find(keyword => haystack.includes(keyword));
}

export function resolveSkillExecutionPolicy(
  skill: DiscoveredSkill,
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
  skill: DiscoveredSkill,
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
  skill: DiscoveredSkill
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

export function buildActiveSkillContext(state: SkillRuntimeState): string {
  const loaded = state.loadedSkills
    .map(ref => {
      const content = state.loadedSkillContents[skillRefKey(ref)];
      if (!content) return undefined;
      return { ref, content };
    })
    .filter((entry): entry is { ref: SkillRef; content: string } => Boolean(entry))
    .sort((a, b) => skillRefKey(a.ref).localeCompare(skillRefKey(b.ref)));

  if (loaded.length === 0) return '';

  return [
    'Active session skills:',
    ...loaded.map(({ ref, content }) =>
      [`<skill source="${ref.source}" id="${ref.id}">`, content.trim(), '</skill>'].join('\n')
    ),
  ].join('\n\n');
}

function skillSummary(
  state: SkillRuntimeState,
  skill: DiscoveredSkill,
  agentProfile?: AgentProfileConfig
): Record<string, unknown> {
  const ref: SkillRef = { source: skill.source, id: skill.id };
  return {
    ref,
    id: skill.id,
    name: skill.name,
    description: skill.description,
    source: skill.source,
    eligible: skill.eligible,
    ...(skill.requirements ? { requirements: skill.requirements } : {}),
    ...(skill.metadata ? { metadata: skill.metadata } : {}),
    loaded: isLoaded(state, ref),
    executionPolicy: resolveSkillExecutionPolicy(skill, undefined, agentProfile),
  };
}

type LoadSkillOutcome =
  | { ok: true; ref: SkillRef; name: string }
  | {
      ok: false;
      error: string;
      message: string;
      ref?: SkillRef;
      executionPolicy?: SkillExecutionPolicy;
    };

const SKILL_LOADED_MESSAGE =
  'Skill loaded for this session. Its full SKILL.md content will be injected as active skill context on the next assistant step.';

/**
 * Structured core of LoadSkill. Programmatic callers (InvokeSkill, direct chat
 * invocation) consume this object directly instead of JSON-parsing the
 * model-facing text result — plain-text failure bodies used to blow up that
 * parse, and the ok:true spread then masked the error.
 */
async function loadSkillStructured(
  state: SkillRuntimeState,
  ref: SkillRef,
  agentProfile?: AgentProfileConfig,
  args?: string
): Promise<LoadSkillOutcome> {
  const skill = findSkill(state, ref);
  if (!skill) {
    return {
      ok: false,
      error: 'skill_not_found',
      message: `Skill not found or not eligible: ${ref.source}/${ref.id}`,
      ref,
    };
  }

  const policy = resolveSkillExecutionPolicy(skill, undefined, agentProfile);
  if (!policy.modes.includes('inline')) {
    return {
      ok: false,
      error: 'policy_denied_inline',
      message:
        'This skill does not allow inline loading. Use RunSkill when fork execution is allowed.',
      ref,
      executionPolicy: policy,
    };
  }

  const content = await loadDiscoveredSkillContent(ref);
  if (!content) {
    return {
      ok: false,
      error: 'skill_content_unavailable',
      message: `Skill content unavailable: ${ref.source}/${ref.id}`,
      ref,
    };
  }

  const key = skillRefKey(ref);
  state.loadedSkillContents[key] = substituteSkillArguments(
    content,
    args,
    skill.metadata?.arguments
  );
  if (!isLoaded(state, ref)) {
    state.loadedSkills.push(ref);
    state.loadedSkills.sort((a, b) => skillRefKey(a).localeCompare(skillRefKey(b)));
  }

  return { ok: true, ref, name: skill.name };
}

/** Model-facing LoadSkill result; the text contract is part of the tool API. */
async function loadSkill(
  state: SkillRuntimeState,
  ref: SkillRef,
  agentProfile?: AgentProfileConfig,
  args?: string
) {
  const outcome = await loadSkillStructured(state, ref, agentProfile, args);
  if (!outcome.ok) {
    if (outcome.error === 'policy_denied_inline') {
      return jsonResult(
        {
          ok: false,
          error: outcome.error,
          ref: outcome.ref,
          executionPolicy: outcome.executionPolicy,
          message: outcome.message,
        },
        { ok: false, error: outcome.error, ref: outcome.ref }
      );
    }
    return textResult(outcome.message, {
      ok: false,
      error: outcome.error,
      ...(outcome.ref ? { ref: outcome.ref } : {}),
    });
  }

  return textResult(
    JSON.stringify(
      {
        loaded: true,
        ref,
        name: outcome.name,
        ...(args !== undefined ? { args } : {}),
        availability: 'next_model_request',
        message: SKILL_LOADED_MESSAGE,
      },
      null,
      2
    ),
    { ok: true, ref }
  );
}

const READ_ONLY_SKILL_TOOLS: ToolName[] = ['Read', 'Grep', 'Glob', 'LS'];
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
      .map(block => {
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

function buildForkSystemPrompt(
  ref: SkillRef,
  content: string,
  policy: SkillExecutionPolicy
): string {
  const lines = [
    'You are executing the following skill as an isolated worker for a parent agent.',
    '',
    `<skill source="${ref.source}" id="${ref.id}">`,
    content.trim(),
    '</skill>',
    '',
    'Complete the user task using this skill.',
    'Return a concise result for the parent agent.',
    'Do not assume your intermediate messages are visible to the parent.',
  ];
  // Only forbid writes when the resolved fork policy actually withholds write
  // tools — a 'workspace-edit' fork grants Write/Edit in the same run, so the
  // blanket no-modify line would contradict the tool set.
  if ((policy.forkToolPolicy ?? 'read-only') !== 'workspace-edit') {
    lines.push('Do not modify files unless a future policy explicitly grants write access.');
  }
  return lines.join('\n');
}

function resolveForkSkillToolNames(
  execution: SkillExecutionDependencies,
  policy: SkillExecutionPolicy
): ToolName[] {
  const parentEnabled = new Set((execution.enabledTools ?? READ_ONLY_SKILL_TOOLS).map(String));
  const forkToolPolicy = policy.forkToolPolicy ?? 'read-only';
  const candidates = (() => {
    if (forkToolPolicy === 'web') return [...READ_ONLY_SKILL_TOOLS, ...WEB_SKILL_TOOLS];
    if (forkToolPolicy === 'workspace-edit')
      return [...READ_ONLY_SKILL_TOOLS, ...WORKSPACE_EDIT_SKILL_TOOLS];
    if (forkToolPolicy === 'agent-default') {
      return (execution.enabledTools ?? READ_ONLY_SKILL_TOOLS)
        .filter(isToolName)
        .filter(tool => !AGENT_DEFAULT_EXCLUDED_TOOLS.has(tool));
    }
    return READ_ONLY_SKILL_TOOLS;
  })();
  return [...new Set(candidates)].filter(tool => parentEnabled.has(tool));
}

function buildForkSkillTools(
  execution: SkillExecutionDependencies,
  policy: SkillExecutionPolicy
): AgentTool[] {
  const enabled = resolveForkSkillToolNames(execution, policy);
  return buildTools(execution.cwd, {
    enabled,
    db: execution.db,
    permissionOverride: execution.permissionOverride,
    permissionCallback: execution.permissionCallback,
  });
}

/**
 * Safety net for forked skill execution: a hung nested agent must not block
 * the parent run's tool call forever. Shorter than the 30-minute sub-agent
 * safety timeout (agent-task-runner) since skills are scoped tasks.
 */
const DEFAULT_SKILL_FORK_TIMEOUT_MS = 10 * 60 * 1000;

function skillForkTimeoutMs(): number {
  const parsed = Number(process.env.ZCLAUDIA_SKILL_FORK_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_SKILL_FORK_TIMEOUT_MS;
}

type ForkPromptOutcome =
  | { kind: 'completed' }
  | { kind: 'failed'; error: unknown }
  | { kind: 'timeout' }
  | { kind: 'aborted' };

async function executeForkedSkill(
  ref: SkillRef,
  skillContent: string,
  task: string,
  execution: SkillExecutionDependencies,
  policy: SkillExecutionPolicy
): Promise<{ ok: true; result: string } | { ok: false; error: string; message: string }> {
  const builtModel = buildModel(execution.llmProfileConfig, execution.agentProfile?.model);
  const agentFactory = execution.agentFactory ?? ((opts: AgentOptions) => new Agent(opts));
  const finalMessages: unknown[] = [];
  const agent = agentFactory({
    initialState: {
      systemPrompt: buildForkSystemPrompt(ref, skillContent, policy),
      model: builtModel.model,
      messages: [],
      tools: buildForkSkillTools(execution, policy),
    },
    streamFn: wrapStreamFnWithToolSchemaCompat(execution.streamFn ?? streamSimple),
    ...(builtModel.getApiKey ? { getApiKey: builtModel.getApiKey } : {}),
  });
  const unsubscribe = agent.subscribe((event: unknown) => {
    const row = event as Record<string, unknown>;
    if (row.type === 'agent_end') {
      finalMessages.splice(
        0,
        finalMessages.length,
        ...((Array.isArray(row.messages) ? row.messages : []) as unknown[])
      );
    }
  });

  const timeoutMs = skillForkTimeoutMs();
  const abortSignal = execution.abortSignal;
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  // Both race branches settle through handlers, so a late rejection from the
  // losing side can never surface as an unhandled rejection.
  const promptOutcome: Promise<ForkPromptOutcome> = agent.prompt(`Task:\n${task}`).then(
    () => ({ kind: 'completed' }) as ForkPromptOutcome,
    error => ({ kind: 'failed', error }) as ForkPromptOutcome
  );
  const interruption = new Promise<ForkPromptOutcome>(resolve => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
    timer.unref?.();
    if (abortSignal) {
      if (abortSignal.aborted) {
        resolve({ kind: 'aborted' });
      } else {
        onAbort = () => resolve({ kind: 'aborted' });
        abortSignal.addEventListener('abort', onAbort, { once: true });
      }
    }
  });
  try {
    const outcome = await Promise.race([promptOutcome, interruption]);
    if (outcome.kind === 'timeout') {
      return {
        ok: false,
        error: 'skill_execution_timeout',
        message: `Forked skill execution exceeded the ${Math.round(timeoutMs / 60_000)}-minute safety timeout and was abandoned. Retry with a narrower task or raise ZCLAUDIA_SKILL_FORK_TIMEOUT_MS.`,
      };
    }
    if (outcome.kind === 'aborted') {
      return {
        ok: false,
        error: 'skill_execution_aborted',
        message: 'Forked skill execution was aborted together with the parent run.',
      };
    }
    if (outcome.kind === 'failed') {
      return {
        ok: false,
        error: 'skill_execution_failed',
        message: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
      };
    }
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort && abortSignal) abortSignal.removeEventListener('abort', onAbort);
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

async function runSkill(
  state: SkillRuntimeState,
  params: unknown,
  execution?: SkillExecutionDependencies
) {
  const args = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
  const ref = normalizeSkillRef(args.ref);
  if (!ref) {
    return jsonResult(
      {
        ok: false,
        error: 'invalid_ref',
        message: 'RunSkill requires a valid skill ref.',
      },
      { ok: false, error: 'invalid_ref' }
    );
  }

  const task = typeof args.task === 'string' ? args.task.trim() : '';
  if (!task) {
    return jsonResult(
      {
        ok: false,
        error: 'missing_task',
        ref,
        message: 'RunSkill requires a non-empty task.',
      },
      { ok: false, error: 'missing_task', ref }
    );
  }

  const requestedMode = typeof args.mode === 'string' ? args.mode : undefined;
  if (requestedMode === 'inline') {
    return jsonResult(
      {
        ok: false,
        error: 'inline_mode_not_supported',
        ref,
        message:
          'RunSkill is fork-only in Phase 2A. Use LoadSkill to add a skill as inline active context.',
      },
      { ok: false, error: 'inline_mode_not_supported', ref }
    );
  }
  if (requestedMode !== undefined && requestedMode !== 'fork') {
    return jsonResult(
      {
        ok: false,
        error: 'invalid_mode',
        ref,
        mode: requestedMode,
        message: 'RunSkill mode must be "fork" when provided.',
      },
      { ok: false, error: 'invalid_mode', ref }
    );
  }

  const skill = findSkill(state, ref);
  if (!skill) {
    return jsonResult(
      {
        ok: false,
        error: 'skill_not_found',
        ref,
        message: `Skill not found or not eligible: ${ref.source}/${ref.id}`,
      },
      { ok: false, error: 'skill_not_found', ref }
    );
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
    return jsonResult(
      {
        ok: false,
        error: 'policy_denied_fork',
        ref,
        mode: 'fork',
        executionPolicy: policy,
        ...diagnostics(),
        message: 'This skill does not allow fork execution.',
      },
      { ok: false, error: 'policy_denied_fork', ref }
    );
  }

  if (requestedMode === undefined && policy.defaultMode === 'inline') {
    return jsonResult(
      {
        ok: false,
        error: 'use_load_skill',
        ref,
        executionPolicy: policy,
        ...diagnostics(),
        message:
          'This skill defaults to inline active context. Use LoadSkill, or call RunSkill with mode: "fork" if fork execution is intentional.',
      },
      { ok: false, error: 'use_load_skill', ref }
    );
  }

  const content = await loadDiscoveredSkillContent(ref);
  if (!content) {
    return jsonResult(
      {
        ok: false,
        error: 'skill_content_unavailable',
        ref,
        executionPolicy: policy,
        ...diagnostics(),
        message: `Skill content unavailable: ${ref.source}/${ref.id}`,
      },
      { ok: false, error: 'skill_content_unavailable', ref }
    );
  }

  if (execution) {
    const result = await executeForkedSkill(
      ref,
      substituteSkillArguments(
        content,
        typeof args.args === 'string' ? args.args : undefined,
        skill.metadata?.arguments
      ),
      task,
      execution,
      policy
    );
    if (result.ok) {
      return jsonResult(
        {
          ok: true,
          ref,
          mode: 'fork',
          result: result.result,
          executionPolicy: policy,
          ...diagnostics(),
        },
        { ok: true, ref, mode: 'fork' }
      );
    }
    return jsonResult(
      {
        ok: false,
        error: result.error,
        ref,
        mode: 'fork',
        message: result.message,
        executionPolicy: policy,
        ...diagnostics(),
      },
      { ok: false, error: result.error, ref }
    );
  }

  return jsonResult(
    {
      ok: false,
      error: 'skill_execution_unavailable',
      ref,
      mode: 'fork',
      executionPolicy: policy,
      ...diagnostics(),
      message: 'RunSkill fork execution dependencies are not configured.',
    },
    { ok: false, error: 'skill_execution_unavailable', ref }
  );
}

function parseDirectSkillInput(input: string): { id: string; args: string } | undefined {
  const trimmed = input.trim();
  const match = /^\/([A-Za-z0-9:_-]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) return undefined;
  const id = match[1];
  if (!id) return undefined;
  return { id, args: match[2]?.trim() ?? '' };
}

async function invokeSkill(
  state: SkillRuntimeState,
  params: unknown,
  execution?: SkillExecutionDependencies
) {
  const args = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
  const input = typeof args.input === 'string' ? args.input : '';
  const parsed = parseDirectSkillInput(input);
  if (!parsed) {
    return jsonResult(
      {
        ok: false,
        error: 'invalid_skill_invocation',
        message: 'InvokeSkill input must look like "/skill-id optional args".',
      },
      { ok: false, error: 'invalid_skill_invocation' }
    );
  }
  const skill = findSkillById(state, parsed.id);
  if (!skill) {
    return jsonResult(
      {
        ok: false,
        error: 'skill_not_found',
        id: parsed.id,
        message: `Skill not found or not eligible: ${parsed.id}`,
      },
      { ok: false, error: 'skill_not_found', id: parsed.id }
    );
  }
  const ref: SkillRef = { source: skill.source, id: skill.id };
  if (skill.metadata?.userInvocable === false) {
    return jsonResult(
      {
        ok: false,
        error: 'skill_not_user_invocable',
        ref,
        message: `Skill ${skill.id} can only be invoked by the model.`,
      },
      { ok: false, error: 'skill_not_user_invocable', ref }
    );
  }
  const policy = resolveSkillExecutionPolicy(skill, undefined, execution?.agentProfile);
  if (policy.defaultMode === 'fork' && policy.modes.includes('fork')) {
    return runSkill(
      state,
      {
        ref,
        task: parsed.args || `Run ${skill.name}`,
        args: parsed.args,
        mode: 'fork',
      },
      execution
    );
  }
  const outcome = await loadSkillStructured(state, ref, execution?.agentProfile, parsed.args);
  if (!outcome.ok) {
    return jsonResult(
      {
        ok: false,
        error: outcome.error,
        ref,
        mode: 'inline',
        args: parsed.args,
        ...(outcome.executionPolicy ? { executionPolicy: outcome.executionPolicy } : {}),
        message: outcome.message,
      },
      { ok: false, error: outcome.error, ref }
    );
  }
  return jsonResult(
    {
      loaded: true,
      ref,
      name: outcome.name,
      ok: true,
      mode: 'inline',
      args: parsed.args,
      availability: 'next_model_request',
      message: SKILL_LOADED_MESSAGE,
    },
    { ok: true, ref, mode: 'inline' }
  );
}

export async function prepareDirectSkillInvocation(
  state: SkillRuntimeState | undefined,
  input: string,
  options: { agentProfile?: AgentProfileConfig } = {}
): Promise<DirectSkillInvocationResult> {
  if (!state) return { matched: false };
  const parsed = parseDirectSkillInput(input);
  if (!parsed) return { matched: false };
  const skill = findSkillById(state, parsed.id);
  if (!skill) return { matched: false };
  const ref: SkillRef = { source: skill.source, id: skill.id };
  if (skill.metadata?.userInvocable === false) {
    return {
      matched: true,
      ok: false,
      error: 'skill_not_user_invocable',
      ref,
      message: `Skill ${skill.id} can only be invoked by the model.`,
    };
  }
  const policy = resolveSkillExecutionPolicy(skill, undefined, options.agentProfile);
  if (policy.defaultMode === 'fork' && policy.modes.includes('fork')) {
    return {
      matched: true,
      ok: true,
      mode: 'fork',
      ref,
      task: parsed.args || `Run ${skill.name}`,
      args: parsed.args,
      message: `Running skill /${skill.id}.`,
    };
  }
  if (!policy.modes.includes('inline')) {
    return {
      matched: true,
      ok: false,
      error: 'skill_not_inline_invocable',
      ref,
      message: `Skill ${skill.id} requires fork execution and cannot be invoked directly in chat yet.`,
    };
  }
  const outcome = await loadSkillStructured(state, ref, options.agentProfile, parsed.args);
  if (!outcome.ok) {
    return {
      matched: true,
      ok: false,
      error: outcome.error,
      ref,
      message: outcome.message,
    };
  }
  recordSkillUsage(ref);
  return {
    matched: true,
    ok: true,
    mode: 'inline',
    ref,
    processedInput: parsed.args || `Use the ${skill.name} skill.`,
    message: `Loaded skill /${skill.id} for this turn.`,
  };
}

export async function executePreparedDirectSkillInvocation(
  state: SkillRuntimeState,
  prepared: PreparedDirectForkSkillInvocation,
  execution: SkillExecutionDependencies
): Promise<DirectForkSkillExecutionResult> {
  const result = await runSkill(
    state,
    {
      ref: prepared.ref,
      task: prepared.task,
      args: prepared.args,
      mode: 'fork',
    },
    execution
  );
  const payload = JSON.parse(textResultText(result)) as {
    ok?: boolean;
    mode?: string;
    ref?: SkillRef;
    result?: string;
    error?: string;
    message?: string;
  };
  if (payload.ok && payload.mode === 'fork' && typeof payload.result === 'string') {
    recordSkillUsage(prepared.ref);
    return {
      ok: true,
      mode: 'fork',
      ref: prepared.ref,
      result: payload.result,
    };
  }
  return {
    ok: false,
    mode: 'fork',
    ref: prepared.ref,
    error: payload.error ?? 'skill_execution_failed',
    message: payload.message ?? `Failed to execute skill ${prepared.ref.id}.`,
  };
}

function textResultText(result: { content: ToolContent }): string {
  const first = result.content[0];
  return first && first.type === 'text' ? first.text : '{}';
}

export function buildSkillMetaTools(options: SkillRuntimeOptions): AgentTool[] {
  const { state, execution } = options;
  return [
    {
      name: 'ListSkills',
      label: 'ListSkills',
      description: 'List skills that are discoverable and can be loaded as active session context.',
      parameters: agentToolParameters({ type: 'object', properties: {} }),
      execute: async () =>
        textResult(
          JSON.stringify(
            {
              skills: state.discoverableSkills.map(skill =>
                skillSummary(state, skill, execution?.agentProfile)
              ),
            },
            null,
            2
          ),
          { ok: true, count: state.discoverableSkills.length }
        ),
    },
    {
      name: 'SearchSkills',
      label: 'SearchSkills',
      description:
        'Search discoverable skills by id, name, source, or description before loading full skill context.',
      parameters: agentToolParameters({
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number', default: 10 },
        },
      }),
      execute: async (_id: string, params: unknown) => {
        const args = (params && typeof params === 'object' ? params : {}) as Record<
          string,
          unknown
        >;
        const query = String(args.query ?? '')
          .trim()
          .toLowerCase();
        const limit = Math.max(1, Math.min(Number(args.limit ?? 10) || 10, 50));
        const results = state.discoverableSkills
          .filter(skill => {
            if (!query) return true;
            const haystack = [
              skill.id,
              skill.name,
              skill.description,
              skill.source,
              skill.metadata?.whenToUse,
              skill.metadata?.argumentHint,
              ...(skill.metadata?.allowedTools ?? []),
              ...(skill.metadata?.paths ?? []),
              ...(skill.metadata?.arguments ?? []),
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            return haystack.includes(query);
          })
          .slice(0, limit)
          .map(skill => skillSummary(state, skill, execution?.agentProfile));
        return textResult(JSON.stringify({ results }, null, 2), {
          ok: true,
          total: results.length,
        });
      },
    },
    {
      name: 'InspectSkill',
      label: 'InspectSkill',
      description: 'Inspect one skill metadata entry without loading its full SKILL.md body.',
      parameters: agentToolParameters({
        type: 'object',
        properties: { ref: { type: 'object' } },
        required: ['ref'],
      }),
      execute: async (_id: string, params: unknown) => {
        const ref = normalizeSkillRef((params as { ref?: unknown })?.ref);
        if (!ref)
          return textResult('InspectSkill requires a valid skill ref', {
            ok: false,
            error: 'invalid_ref',
          });
        const skill = findSkill(state, ref);
        if (!skill)
          return textResult(`Skill not found or not eligible: ${ref.source}/${ref.id}`, {
            ok: false,
            error: 'skill_not_found',
            ref,
          });
        return textResult(
          JSON.stringify(
            {
              ...skillSummary(state, skill, execution?.agentProfile),
              filePath: skill.filePath,
              dirPath: skill.dirPath,
              contentLoaded: Boolean(state.loadedSkillContents[skillRefKey(ref)]),
            },
            null,
            2
          ),
          { ok: true, ref }
        );
      },
    },
    {
      name: 'LoadSkill',
      label: 'LoadSkill',
      description:
        'Load one skill for this session so its full SKILL.md becomes inline active context on the next assistant step.',
      parameters: agentToolParameters({
        type: 'object',
        properties: { ref: { type: 'object' } },
        required: ['ref'],
      }),
      execute: async (_id: string, params: unknown) => {
        const row = (params && typeof params === 'object' ? params : {}) as {
          ref?: unknown;
          args?: unknown;
        };
        const ref = normalizeSkillRef(row.ref);
        if (!ref)
          return textResult('LoadSkill requires a valid skill ref', {
            ok: false,
            error: 'invalid_ref',
          });
        return loadSkill(
          state,
          ref,
          execution?.agentProfile,
          typeof row.args === 'string' ? row.args : undefined
        );
      },
    },
    {
      name: 'InvokeSkill',
      label: 'InvokeSkill',
      description:
        'Invoke a user-facing skill from slash-style input such as "/skill-id optional args".',
      parameters: agentToolParameters({
        type: 'object',
        properties: {
          input: { type: 'string' },
        },
        required: ['input'],
      }),
      execute: async (_id: string, params: unknown) => invokeSkill(state, params, execution),
    },
    {
      name: 'RunSkill',
      label: 'RunSkill',
      description:
        'Execute a fork-capable skill once as an isolated worker and return its result without changing active skill context.',
      parameters: agentToolParameters({
        type: 'object',
        properties: {
          ref: { type: 'object' },
          task: { type: 'string' },
          mode: { type: 'string', enum: ['fork', 'inline'] },
        },
        required: ['ref', 'task'],
      }),
      execute: async (_id: string, params: unknown) => runSkill(state, params, execution),
    },
  ];
}
