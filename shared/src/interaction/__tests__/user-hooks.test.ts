import { describe, it, expect } from 'vitest';
import {
  parseUserHooks,
  matchesToolRule,
  clampHookTimeout,
  DEFAULT_HOOK_TIMEOUT_MS,
  MAX_HOOK_TIMEOUT_MS,
  MIN_HOOK_TIMEOUT_MS,
} from '../user-hooks.js';

describe('parseUserHooks', () => {
  it('accepts valid hook entries', () => {
    const { hooks, warnings } = parseUserHooks([
      { event: 'PreToolUse', matcher: 'Bash(git *)', command: 'lint.sh' },
      { event: 'PostToolUse', command: 'audit.sh', timeoutMs: 5000, enabled: false },
    ]);
    expect(warnings).toEqual([]);
    expect(hooks).toEqual([
      { event: 'PreToolUse', matcher: 'Bash(git *)', command: 'lint.sh' },
      { event: 'PostToolUse', command: 'audit.sh', timeoutMs: 5000, enabled: false },
    ]);
  });

  it('drops invalid entries with reasons', () => {
    const { hooks, warnings } = parseUserHooks([
      { event: 'OnBoot', command: 'x' },
      { event: 'PreToolUse' },
      { event: 'PreToolUse', command: 'x', matcher: 'Bash(broken' },
      null,
      'junk',
    ]);
    expect(hooks).toEqual([]);
    expect(warnings).toHaveLength(5);
    expect(warnings[2]).toContain('invalid matcher');
  });

  it('treats null/undefined as empty and non-array as warning', () => {
    expect(parseUserHooks(null)).toEqual({ hooks: [], warnings: [] });
    expect(parseUserHooks({})).toEqual({ hooks: [], warnings: ['hooks config is not an array'] });
  });

  it('clamps timeoutMs', () => {
    const { hooks } = parseUserHooks([{ event: 'PreToolUse', command: 'x', timeoutMs: 999_999 }]);
    expect(hooks[0].timeoutMs).toBe(MAX_HOOK_TIMEOUT_MS);
  });
});

describe('clampHookTimeout', () => {
  it('defaults, floors and caps', () => {
    expect(clampHookTimeout(undefined)).toBe(DEFAULT_HOOK_TIMEOUT_MS);
    expect(clampHookTimeout(10)).toBe(MIN_HOOK_TIMEOUT_MS);
    expect(clampHookTimeout(120_000)).toBe(MAX_HOOK_TIMEOUT_MS);
    expect(clampHookTimeout(5_000)).toBe(5_000);
  });
});

describe('matchesToolRule', () => {
  it('matches by tool name, wildcard, and pattern', () => {
    expect(matchesToolRule({ toolName: 'Bash' }, 'Bash', 'anything')).toBe(true);
    expect(matchesToolRule({ toolName: '*' }, 'Read', 'x')).toBe(true);
    expect(matchesToolRule({ toolName: 'Bash' }, 'Read', 'x')).toBe(false);
    expect(
      matchesToolRule({ toolName: 'Bash', pattern: '^git(\\s.*)?$' }, 'Bash', 'git status')
    ).toBe(true);
    expect(matchesToolRule({ toolName: 'Bash', pattern: '^git(\\s.*)?$' }, 'Bash', 'npm i')).toBe(
      false
    );
  });

  it('treats invalid regex as non-match', () => {
    expect(matchesToolRule({ toolName: 'Bash', pattern: '(' }, 'Bash', 'x')).toBe(false);
  });
});
