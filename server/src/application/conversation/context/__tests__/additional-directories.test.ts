import { describe, expect, it } from 'vitest';
import { buildAdditionalDirectoriesPrompt } from '../additional-directories.js';
import { createContextEngine } from '../engine.js';

describe('buildAdditionalDirectoriesPrompt', () => {
  it('emits nothing without additional directories', () => {
    expect(buildAdditionalDirectoriesPrompt([])).toBeUndefined();
    expect(buildAdditionalDirectoriesPrompt(undefined)).toBeUndefined();
  });

  it('lists every directory and explains how to use them', () => {
    const text = buildAdditionalDirectoriesPrompt(['/a/one', '/b/two'])!;
    expect(text).toContain('Additional directories (read/write allowed):');
    expect(text).toContain('- /a/one');
    expect(text).toContain('- /b/two');
    expect(text).toMatch(/relative paths .* primary/i);
    expect(text).toMatch(/absolute paths/i);
    expect(text).toMatch(/git/i);
  });

  it('is deterministic so the prompt-cache prefix is stable', () => {
    expect(buildAdditionalDirectoriesPrompt(['/a', '/b'])).toBe(
      buildAdditionalDirectoriesPrompt(['/a', '/b'])
    );
  });
});

describe('context engine additional directories', () => {
  const base = { sessionId: 's', workspacePrompt: 'WORKSPACE', memoryContext: 'MEMORY' };

  it('leaves the assembled prompt untouched when the fragment is absent', () => {
    const engine = createContextEngine();
    expect(engine.assemble('coding', base)).toBe('WORKSPACE\n\nMEMORY');
  });

  it('inserts the fragment right after the workspace prompt', () => {
    const engine = createContextEngine();
    const out = engine.assemble('coding', { ...base, additionalDirectoriesPrompt: 'EXTRA' });
    expect(out).toBe('WORKSPACE\n\nEXTRA\n\nMEMORY');
  });
});
