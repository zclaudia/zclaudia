import { randomUUID } from 'node:crypto';
import type { AgentOptions, StreamFn } from '@earendil-works/pi-agent-core';
import type Database from 'better-sqlite3';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type {
  SkillSource,
  SkillRef,
  SkillExecutionMode as SharedSkillExecutionMode,
  SkillForkToolPolicy,
} from '@zclaudia/shared/core/skills';
import type { UnifiedPermissionPolicy } from '@zclaudia/shared/interaction/permissions';
import type { TaskPort } from '../../../utils/task-port.js';
import type { PermissionCallback } from '../message-types.js';
import type { PiToolLookupPort } from '../types.js';
import type { PlanModePort } from './plan-mode-port.js';
import { textResult, type ToolContent } from './tool-common.js';
import {
  isLoaded,
  resolveSkillExecutionPolicy,
  skillRefKey,
  type SkillExecutionPolicy,
} from './skill-policy.js';
import { executeForkedSkill, resolveForkSkillToolNames } from './skill-fork.js';

export type SkillExecutionMode = 'inline' | 'fork';

export interface RuntimeDiscoveredSkill {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  filePath: string;
  dirPath: string;
  eligible?: boolean;
  requirements?: { os?: string[]; binaries?: string[]; env?: string[] };
  metadata?: {
    whenToUse?: string;
    allowedTools?: string[];
    paths?: string[];
    arguments?: string[];
    argumentHint?: string;
    userInvocable?: boolean;
    hookTriggers?: { tools?: string[]; paths?: string[] };
  };
  execution?: {
    allowedModes?: SharedSkillExecutionMode[];
    defaultMode?: SharedSkillExecutionMode;
    forkToolPolicy?: SkillForkToolPolicy;
  };
}

export interface SkillContentPort {
  loadContent(ref: SkillRef): Promise<string | null>;
  recordUsage(ref: SkillRef): void;
}

const EMPTY_SKILL_CONTENT_PORT: SkillContentPort = {
  loadContent: async () => null,
  recordUsage: () => undefined,
};

export interface SkillRuntimeState {
  discoverableSkills: RuntimeDiscoveredSkill[];
  pinnedSkills: SkillRef[];
  loadedSkills: SkillRef[];
  loadedSkillContents: Record<string, string>;
  contentPort: SkillContentPort;
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
  planModePort?: PlanModePort;
  taskPort?: TaskPort;
  /** Host lookups forwarded to the forked skill's built-in tools. */
  toolLookups?: PiToolLookupPort;
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

export function findSkill(
  state: SkillRuntimeState,
  ref: SkillRef
): RuntimeDiscoveredSkill | undefined {
  return state.discoverableSkills.find(skill => skill.source === ref.source && skill.id === ref.id);
}

function findSkillById(state: SkillRuntimeState, id: string): RuntimeDiscoveredSkill | undefined {
  return state.discoverableSkills.find(skill => skill.id === id || skill.name === id);
}

export function normalizeSkillRef(input: unknown): SkillRef | undefined {
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
  discoverableSkills: RuntimeDiscoveredSkill[],
  pinnedSkills: SkillRef[] = [],
  contentPort: SkillContentPort = EMPTY_SKILL_CONTENT_PORT
): SkillRuntimeState {
  return {
    discoverableSkills,
    pinnedSkills,
    loadedSkills: [...pinnedSkills],
    loadedSkillContents: {},
    contentPort,
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

  const content = await state.contentPort.loadContent(ref);
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
export async function loadSkill(
  state: SkillRuntimeState,
  ref: SkillRef,
  agentProfile?: AgentProfileConfig,
  args?: string
) {
  const outcome = await loadSkillStructured(state, ref, agentProfile, args);
  if (!outcome.ok) {
    if (outcome.error === 'policy_denied_inline') {
      return textResult(
        JSON.stringify(
          {
            ok: false,
            error: outcome.error,
            ref: outcome.ref,
            executionPolicy: outcome.executionPolicy,
            message: outcome.message,
          },
          null,
          2
        ),
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

export async function runSkill(
  state: SkillRuntimeState,
  params: unknown,
  execution?: SkillExecutionDependencies
) {
  const args = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
  const ref = normalizeSkillRef(args.ref);
  if (!ref) {
    return textResult(
      JSON.stringify(
        {
          ok: false,
          error: 'invalid_ref',
          message: 'RunSkill requires a valid skill ref.',
        },
        null,
        2
      ),
      { ok: false, error: 'invalid_ref' }
    );
  }

  const task = typeof args.task === 'string' ? args.task.trim() : '';
  if (!task) {
    return textResult(
      JSON.stringify(
        {
          ok: false,
          error: 'missing_task',
          ref,
          message: 'RunSkill requires a non-empty task.',
        },
        null,
        2
      ),
      { ok: false, error: 'missing_task', ref }
    );
  }

  const requestedMode = typeof args.mode === 'string' ? args.mode : undefined;
  if (requestedMode === 'inline') {
    return textResult(
      JSON.stringify(
        {
          ok: false,
          error: 'inline_mode_not_supported',
          ref,
          message:
            'RunSkill is fork-only in Phase 2A. Use LoadSkill to add a skill as inline active context.',
        },
        null,
        2
      ),
      { ok: false, error: 'inline_mode_not_supported', ref }
    );
  }
  if (requestedMode !== undefined && requestedMode !== 'fork') {
    return textResult(
      JSON.stringify(
        {
          ok: false,
          error: 'invalid_mode',
          ref,
          mode: requestedMode,
          message: 'RunSkill mode must be "fork" when provided.',
        },
        null,
        2
      ),
      { ok: false, error: 'invalid_mode', ref }
    );
  }

  const skill = findSkill(state, ref);
  if (!skill) {
    return textResult(
      JSON.stringify(
        {
          ok: false,
          error: 'skill_not_found',
          ref,
          message: `Skill not found or not eligible: ${ref.source}/${ref.id}`,
        },
        null,
        2
      ),
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
    return textResult(
      JSON.stringify(
        {
          ok: false,
          error: 'policy_denied_fork',
          ref,
          mode: 'fork',
          executionPolicy: policy,
          ...diagnostics(),
          message: 'This skill does not allow fork execution.',
        },
        null,
        2
      ),
      { ok: false, error: 'policy_denied_fork', ref }
    );
  }

  if (requestedMode === undefined && policy.defaultMode === 'inline') {
    return textResult(
      JSON.stringify(
        {
          ok: false,
          error: 'use_load_skill',
          ref,
          executionPolicy: policy,
          ...diagnostics(),
          message:
            'This skill defaults to inline active context. Use LoadSkill, or call RunSkill with mode: "fork" if fork execution is intentional.',
        },
        null,
        2
      ),
      { ok: false, error: 'use_load_skill', ref }
    );
  }

  const content = await state.contentPort.loadContent(ref);
  if (!content) {
    return textResult(
      JSON.stringify(
        {
          ok: false,
          error: 'skill_content_unavailable',
          ref,
          executionPolicy: policy,
          ...diagnostics(),
          message: `Skill content unavailable: ${ref.source}/${ref.id}`,
        },
        null,
        2
      ),
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
      return textResult(
        JSON.stringify(
          {
            ok: true,
            ref,
            mode: 'fork',
            result: result.result,
            executionPolicy: policy,
            ...diagnostics(),
          },
          null,
          2
        ),
        { ok: true, ref, mode: 'fork' }
      );
    }
    return textResult(
      JSON.stringify(
        {
          ok: false,
          error: result.error,
          ref,
          mode: 'fork',
          message: result.message,
          executionPolicy: policy,
          ...diagnostics(),
        },
        null,
        2
      ),
      { ok: false, error: result.error, ref }
    );
  }

  return textResult(
    JSON.stringify(
      {
        ok: false,
        error: 'skill_execution_unavailable',
        ref,
        mode: 'fork',
        executionPolicy: policy,
        ...diagnostics(),
        message: 'RunSkill fork execution dependencies are not configured.',
      },
      null,
      2
    ),
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

export async function invokeSkill(
  state: SkillRuntimeState,
  params: unknown,
  execution?: SkillExecutionDependencies
) {
  const args = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
  const input = typeof args.input === 'string' ? args.input : '';
  const parsed = parseDirectSkillInput(input);
  if (!parsed) {
    return textResult(
      JSON.stringify(
        {
          ok: false,
          error: 'invalid_skill_invocation',
          message: 'InvokeSkill input must look like "/skill-id optional args".',
        },
        null,
        2
      ),
      { ok: false, error: 'invalid_skill_invocation' }
    );
  }
  const skill = findSkillById(state, parsed.id);
  if (!skill) {
    return textResult(
      JSON.stringify(
        {
          ok: false,
          error: 'skill_not_found',
          id: parsed.id,
          message: `Skill not found or not eligible: ${parsed.id}`,
        },
        null,
        2
      ),
      { ok: false, error: 'skill_not_found', id: parsed.id }
    );
  }
  const ref: SkillRef = { source: skill.source, id: skill.id };
  if (skill.metadata?.userInvocable === false) {
    return textResult(
      JSON.stringify(
        {
          ok: false,
          error: 'skill_not_user_invocable',
          ref,
          message: `Skill ${skill.id} can only be invoked by the model.`,
        },
        null,
        2
      ),
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
    return textResult(
      JSON.stringify(
        {
          ok: false,
          error: outcome.error,
          ref,
          mode: 'inline',
          args: parsed.args,
          ...(outcome.executionPolicy ? { executionPolicy: outcome.executionPolicy } : {}),
          message: outcome.message,
        },
        null,
        2
      ),
      { ok: false, error: outcome.error, ref }
    );
  }
  return textResult(
    JSON.stringify(
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
      null,
      2
    ),
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
  state.contentPort.recordUsage(ref);
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
    state.contentPort.recordUsage(prepared.ref);
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
