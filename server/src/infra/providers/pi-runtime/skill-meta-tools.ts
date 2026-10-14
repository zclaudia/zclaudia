import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { SkillRef } from '@zclaudia/shared/core/skills';
import { isLoaded, resolveSkillExecutionPolicy, skillRefKey } from './skill-policy.js';
import {
  findSkill,
  invokeSkill,
  loadSkill,
  normalizeSkillRef,
  runSkill,
  type RuntimeDiscoveredSkill,
  type SkillRuntimeOptions,
  type SkillRuntimeState,
} from './skills.js';
import { agentToolParameters, textResult } from './tool-common.js';

function skillSummary(
  state: SkillRuntimeState,
  skill: RuntimeDiscoveredSkill,
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
