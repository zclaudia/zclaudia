import { describe, it, expect } from 'vitest';
import { createContextEngine } from '../engine.js';
import type { AssemblyInput } from '../types.js';

const baseInput: AssemblyInput = {
  sessionId: 'test-session',
  workspacePrompt: 'WS',
  skillDirectoryHint: 'SKILL_HINT_MARKER',
  systemContext: 'SYS',
};

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
