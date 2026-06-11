import { describe, it, expect } from 'vitest';
import { parseToolRule, formatToolRule, suggestRuleForRequest, compileGlob } from '../tool-rule-syntax.js';

describe('compileGlob', () => {
  it('escapes regex specials and translates wildcards', () => {
    expect(compileGlob('*.env')).toBe('^.*\\.env$');
    expect(compileGlob('npm run build')).toBe('^npm run build$');
    expect(compileGlob('a+b(c)')).toBe('^a\\+b\\(c\\)$');
    expect(compileGlob('file?.txt')).toBe('^file.\\.txt$');
  });

  it('compiles the Bash smart trailing " *" to optional-args', () => {
    expect(compileGlob('git push *')).toBe('^git push(\\s.*)?$');
    const re = new RegExp(compileGlob('git push *'), 'i');
    expect(re.test('git push')).toBe(true);
    expect(re.test('git push origin main')).toBe(true);
    expect(re.test('git pushX')).toBe(false);
  });
});

describe('parseToolRule', () => {
  it('parses bare tool names', () => {
    expect(parseToolRule('WebFetch')).toEqual({ ok: true, rule: { toolName: 'WebFetch' } });
    expect(parseToolRule('*')).toEqual({ ok: true, rule: { toolName: '*' } });
  });

  it('parses Tool(glob) into a compiled pattern', () => {
    expect(parseToolRule('Bash(git *)')).toEqual({ ok: true, rule: { toolName: 'Bash', pattern: '^git(\\s.*)?$' } });
    expect(parseToolRule('Read(*.env)')).toEqual({ ok: true, rule: { toolName: 'Read', pattern: '^.*\\.env$' } });
  });

  it('passes ToolName(/regex/) through verbatim', () => {
    expect(parseToolRule('Bash(/^docker (run|exec)/)')).toEqual({ ok: true, rule: { toolName: 'Bash', pattern: '^docker (run|exec)' } });
  });

  it('rejects invalid syntax', () => {
    expect(parseToolRule('').ok).toBe(false);
    expect(parseToolRule('Bash(git *').ok).toBe(false);
    expect(parseToolRule('Ba sh(x)').ok).toBe(false);
    expect(parseToolRule('Bash()').ok).toBe(false);
  });
});

describe('formatToolRule (round-trip)', () => {
  it('round-trips compiler-produced rules back to glob text', () => {
    for (const text of ['Bash(git *)', 'Read(*.env)', 'Bash(npm run build *)', 'WebFetch', 'Bash(file?.txt)']) {
      const parsed = parseToolRule(text);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(formatToolRule(parsed.rule)).toBe(text);
    }
  });

  it('falls back to /regex/ display for foreign regexes', () => {
    expect(formatToolRule({ toolName: 'Bash', pattern: '^docker (run|exec)' })).toBe('Bash(/^docker (run|exec)/)');
  });

  it('does not decompile foreign escape sequences to wrong globs', () => {
    expect(formatToolRule({ toolName: 'Bash', pattern: '^git\\scommit$' })).toBe('Bash(/^git\\scommit$/)');
    expect(formatToolRule({ toolName: 'Bash', pattern: '^git\\tcommit$' })).toBe('Bash(/^git\\tcommit$/)');
  });

  it('still decompiles compiler-escaped specials', () => {
    expect(formatToolRule({ toolName: 'Read', pattern: '^.*\\.env$' })).toBe('Read(*.env)');
  });
});

describe('suggestRuleForRequest', () => {
  it('suggests two-word prefix for multi-word bash commands', () => {
    expect(suggestRuleForRequest('Bash', 'git push origin main')).toBe('Bash(git push *)');
  });
  it('suggests exact match for single-word commands', () => {
    expect(suggestRuleForRequest('Bash', 'ls')).toBe('Bash(ls)');
  });
  it('suggests bare tool name for non-bash tools', () => {
    expect(suggestRuleForRequest('WebFetch', 'https://example.com')).toBe('WebFetch');
  });
  it('falls back to bare Bash when words contain parens', () => {
    expect(suggestRuleForRequest('Bash', 'echo $(date) now')).toBe('Bash');
  });
});
