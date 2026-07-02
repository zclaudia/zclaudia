import { describe, expect, it } from 'vitest';
import { normalizeSkillExecutionSelection, type SkillExecutionSelection } from '../skills.js';
import type { AgentProfileConfig } from '../agent-profile.js';

describe('skill execution selection', () => {
  it('normalizes valid execution overrides', () => {
    expect(
      normalizeSkillExecutionSelection({
        overrides: [
          {
            ref: { source: 'workspace', id: 'guidelines' },
            allowedModes: ['inline', 'fork'],
            defaultMode: 'fork',
            forkToolPolicy: 'web',
          },
        ],
      })
    ).toEqual({
      overrides: [
        {
          ref: { source: 'workspace', id: 'guidelines' },
          allowedModes: ['inline', 'fork'],
          defaultMode: 'fork',
          forkToolPolicy: 'web',
        },
      ],
    });
  });

  it('drops invalid modes and fork tool policies', () => {
    expect(
      normalizeSkillExecutionSelection({
        overrides: [
          {
            ref: { source: 'external', id: 'audit' },
            allowedModes: ['fork', 'bad', 'fork'],
            defaultMode: 'bad',
            forkToolPolicy: 'dangerous',
          },
        ],
      })
    ).toEqual({
      overrides: [
        {
          ref: { source: 'external', id: 'audit' },
          allowedModes: ['fork'],
        },
      ],
    });
  });

  it('preserves empty override arrays', () => {
    expect(normalizeSkillExecutionSelection({ overrides: [] })).toEqual({ overrides: [] });
  });

  it('dedupes overrides by skill ref with the last override winning', () => {
    expect(
      normalizeSkillExecutionSelection({
        overrides: [
          {
            ref: { source: 'plugin', id: 'reviewer' },
            defaultMode: 'fork',
          },
          {
            ref: { source: 'plugin', id: 'reviewer' },
            allowedModes: ['inline'],
            defaultMode: 'inline',
            forkToolPolicy: 'read-only',
          },
        ],
      })
    ).toEqual({
      overrides: [
        {
          ref: { source: 'plugin', id: 'reviewer' },
          allowedModes: ['inline'],
          defaultMode: 'inline',
          forkToolPolicy: 'read-only',
        },
      ],
    });
  });

  it('is available on AgentProfileConfig', () => {
    const selection: SkillExecutionSelection = {
      overrides: [{ ref: { source: 'workspace', id: 'guidelines' }, defaultMode: 'inline' }],
    };
    const profile: AgentProfileConfig = {
      id: 'agent-1',
      name: 'Agent',
      llmProfileId: 'llm-1',
      model: 'model',
      systemPrompt: '',
      enabledTools: [],
      skillExecution: selection,
      createdAt: 0,
      updatedAt: 0,
    };

    expect(profile.skillExecution).toBe(selection);
  });
});
