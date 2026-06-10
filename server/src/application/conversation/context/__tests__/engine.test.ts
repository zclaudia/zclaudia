import { describe, it, expect } from 'vitest';
import { createContextEngine } from '../engine.js';
import type { AssemblyInput } from '../types.js';

const baseInput: AssemblyInput = {
  sessionId: 'test-session',
  workspacePrompt: 'WS',
  skillDirectoryHint: 'SKILL_HINT_MARKER',
  systemContext: 'SYS',
};

describe('createContextEngine.assemble — baseSystemPrompt merge', () => {
  const engine = createContextEngine();

  it('coding template leads with baseSystemPrompt, workspace sections after', () => {
    const result = engine.assemble('coding', {
      ...baseInput,
      baseSystemPrompt: 'PROFILE_PROMPT',
    });
    expect(result.startsWith('PROFILE_PROMPT')).toBe(true);
    expect(result.indexOf('PROFILE_PROMPT')).toBeLessThan(result.indexOf('WS'));
    expect(result).toContain('WS');
    expect(result).toContain('SKILL_HINT_MARKER');
  });

  it('agent template replaces built-in persona with baseSystemPrompt (§4.6 full replacement)', () => {
    const result = engine.assemble('agent', {
      ...baseInput,
      baseSystemPrompt: 'PROFILE_PROMPT',
    });
    expect(result.startsWith('PROFILE_PROMPT')).toBe(true);
    expect(result).not.toContain('Agent Assistant for ZClaudia');
    expect(result).toContain('WS');
  });

  it('supervision/review/debug templates replace built-in persona with baseSystemPrompt', () => {
    for (const template of ['supervision', 'review', 'debug'] as const) {
      const result = engine.assemble(template, {
        ...baseInput,
        baseSystemPrompt: 'PROFILE_PROMPT',
      });
      expect(result.startsWith('PROFILE_PROMPT')).toBe(true);
      expect(result).not.toContain('Agent for ZClaudia');
      expect(result).toContain('WS');
    }
  });

  it('agent template falls back to built-in persona when baseSystemPrompt is absent', () => {
    const result = engine.assemble('agent', baseInput);
    expect(result).toContain('Agent Assistant for ZClaudia');
  });

  it('coding template without baseSystemPrompt keeps prior shape', () => {
    const result = engine.assemble('coding', baseInput);
    expect(result.startsWith('WS')).toBe(true);
  });

  it('assembly is deterministic for identical input (prompt-cache prefix stability)', () => {
    const input = { ...baseInput, baseSystemPrompt: 'PROFILE_PROMPT' };
    expect(engine.assemble('coding', input)).toBe(engine.assemble('coding', input));
    expect(engine.assemble('agent', input)).toBe(engine.assemble('agent', input));
  });
});

describe('createContextEngine.assemble — skillDirectoryHint coverage', () => {
  const engine = createContextEngine();

  it('coding template includes skillDirectoryHint', () => {
    expect(engine.assemble('coding', baseInput)).toContain('SKILL_HINT_MARKER');
  });

  it('agent template includes skillDirectoryHint', () => {
    expect(engine.assemble('agent', baseInput)).toContain('SKILL_HINT_MARKER');
  });

  it('supervision template includes skillDirectoryHint', () => {
    expect(engine.assemble('supervision', baseInput)).toContain('SKILL_HINT_MARKER');
  });

  it('review template includes skillDirectoryHint', () => {
    expect(engine.assemble('review', baseInput)).toContain('SKILL_HINT_MARKER');
  });

  it('debug template includes skillDirectoryHint', () => {
    expect(engine.assemble('debug', baseInput)).toContain('SKILL_HINT_MARKER');
  });
});
