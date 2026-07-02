import { describe, it, expect } from 'vitest';
import {
  buildPiRunPrompt,
  EDIT_TOOL_SELECTION_GUIDANCE,
  formatMcpInstructionsForPrompt,
  PLAN_MODE_SYSTEM_PROMPT_SUFFIX,
} from '../run-prompt.js';

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
    expect(bundle.effectiveSystemPrompt).toContain('Base.');
    expect(bundle.effectiveSystemPrompt).toContain(EDIT_TOOL_SELECTION_GUIDANCE);
    expect(bundle.effectiveSystemPrompt).not.toContain('# MCP Server Instructions');
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

describe('buildPiRunPrompt — edit tool guidance', () => {
  it('injects edit tool guidance into the effective prompt and token snapshot', () => {
    const bundle = buildPiRunPrompt({ ...base, systemPrompt: 'Base.' });
    expect(bundle.effectiveSystemPrompt).toContain('# Editing Tool Selection');
    expect(bundle.snapshotSystemPromptText).toContain('# Editing Tool Selection');
  });

  it('does not add leading blank lines when the base system prompt is empty', () => {
    const bundle = buildPiRunPrompt(base);
    expect(bundle.effectiveSystemPrompt.startsWith('# Editing Tool Selection')).toBe(true);
  });

  it('keeps plan-mode instructions after edit tool guidance', () => {
    const bundle = buildPiRunPrompt({ ...base, systemPrompt: 'Base.', isPlanMode: true });
    expect(bundle.effectiveSystemPrompt).toContain(EDIT_TOOL_SELECTION_GUIDANCE);
    expect(bundle.effectiveSystemPrompt.endsWith(PLAN_MODE_SYSTEM_PROMPT_SUFFIX)).toBe(true);
  });

  it.each([
    ['same-file replacements', ['MultiEdit', 'edits array', 'atomically']],
    ['symbol-level changes', ['ReadSymbol', 'EditSymbol', 'expected_body_digest']],
    ['line drift', ['hashline:true', 'hashline_operation']],
    ['structural rewrites', ['Write', 'JSON arrays', 'Markdown tables', 'YAML', 'TOML']],
    [
      'post-edit verification loops',
      ['successful Write, Edit, MultiEdit, or EditSymbol', 'do not call Read again'],
    ],
  ])('covers the %s regression case', (_name, expectedTerms) => {
    for (const term of expectedTerms) {
      expect(EDIT_TOOL_SELECTION_GUIDANCE).toContain(term);
    }
  });
});
