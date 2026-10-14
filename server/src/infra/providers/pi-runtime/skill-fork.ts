import { streamSimple } from '@earendil-works/pi-ai/compat';
import {
  Agent,
  type AgentOptions,
  type AgentTool,
  type StreamFn,
} from '@earendil-works/pi-agent-core';
import { ALL_TOOL_NAMES, type ToolName } from '@zclaudia/shared/core/tools';
import type { SkillRef } from '@zclaudia/shared/core/skills';
import { buildModel } from './build-model.js';
import type { SkillExecutionPolicy } from './skill-policy.js';
import type { SkillExecutionDependencies } from './skills.js';
import { buildTools } from './tool-bridge.js';
import { applyToolScheduler } from './tool-scheduler.js';
import { wrapStreamFnWithToolSchemaCompat } from './tool-schema-compat.js';

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

export function resolveForkSkillToolNames(
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
  return applyToolScheduler(
    buildTools(execution.cwd, {
      enabled,
      db: execution.db,
      toolLookups: execution.toolLookups,
      planModePort: execution.planModePort,
      taskPort: execution.taskPort,
      permissionOverride: execution.permissionOverride,
      permissionCallback: execution.permissionCallback,
    })
  );
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

export async function executeForkedSkill(
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
