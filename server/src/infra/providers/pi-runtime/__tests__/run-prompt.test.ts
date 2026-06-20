import { describe, it, expect } from 'vitest';
import { buildPiRunPrompt, formatMcpInstructionsForPrompt } from '../run-prompt.js';

const base = {
  externalProviderCatalog: '',
  skillCatalog: '',
  activeSkillContext: '',
  isPlanMode: false,
};

describe('formatMcpInstructionsForPrompt', () => {
  it('returns empty string when there are no instruction sources', () => {
    expect(formatMcpInstructionsForPrompt([])).toBe('');
  });

  it('renders one section per server with its instructions', () => {
    const out = formatMcpInstructionsForPrompt([
      { name: 'github', instructions: 'Use the GitHub API politely.' },
      { name: 'fs', instructions: 'Do not delete files.' },
    ]);
    expect(out).toContain('github');
    expect(out).toContain('Use the GitHub API politely.');
    expect(out).toContain('fs');
    expect(out).toContain('Do not delete files.');
  });
});

describe('buildPiRunPrompt — mcpInstructions', () => {
  it('appends MCP instructions to the effective system prompt', () => {
    const bundle = buildPiRunPrompt({
      ...base,
      systemPrompt: 'You are an agent.',
      mcpInstructions: '# MCP Server Instructions\n\n## github\nUse the API.',
    });
    expect(bundle.effectiveSystemPrompt).toContain('You are an agent.');
    expect(bundle.effectiveSystemPrompt).toContain('# MCP Server Instructions');
    expect(bundle.effectiveSystemPrompt).toContain('Use the API.');
  });

  it('omits the MCP block entirely when no instructions are provided', () => {
    const bundle = buildPiRunPrompt({ ...base, systemPrompt: 'Base.' });
    expect(bundle.effectiveSystemPrompt).toBe('Base.');
  });

  it('counts MCP instructions in the system-prompt token snapshot text', () => {
    const bundle = buildPiRunPrompt({
      ...base,
      systemPrompt: 'Base.',
      mcpInstructions: 'MCP-INSTRUCTIONS-MARKER',
    });
    expect(bundle.snapshotSystemPromptText).toContain('MCP-INSTRUCTIONS-MARKER');
  });
});
