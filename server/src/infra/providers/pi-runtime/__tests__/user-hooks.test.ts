import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runPreToolUseHooks, runPostToolUseHooks, type HookInvocation } from '../user-hooks.js';
import type { UserHookDefinition } from '@zclaudia/shared/interaction/user-hooks';

let cwd: string;

beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'zc-hooks-')); });
afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

const inv = (over: Partial<HookInvocation> = {}): HookInvocation => ({
  event: 'PreToolUse',
  toolName: 'Bash',
  toolInput: { command: 'git push' },
  detail: 'git push',
  cwd,
  sessionId: 's1',
  ...over,
});

const hook = (over: Record<string, unknown> = {}): UserHookDefinition => ({
  event: 'PreToolUse',
  command: 'exit 0',
  ...over,
} as UserHookDefinition);

describe('runPreToolUseHooks', () => {
  it('exit 0 passes', async () => {
    expect(await runPreToolUseHooks([hook()], inv())).toEqual({ blocked: false });
  });

  it('exit 2 blocks with stderr reason', async () => {
    const out = await runPreToolUseHooks([hook({ command: 'echo "no force pushes" >&2; exit 2' })], inv());
    expect(out.blocked).toBe(true);
    expect(out.reason).toContain('no force pushes');
  });

  it('exit 2 with empty stderr uses the default reason', async () => {
    const out = await runPreToolUseHooks([hook({ command: 'exit 2' })], inv());
    expect(out.blocked).toBe(true);
    expect(out.reason).toContain('Blocked by PreToolUse hook');
  });

  it('other nonzero exits warn and pass', async () => {
    expect((await runPreToolUseHooks([hook({ command: 'exit 1' })], inv())).blocked).toBe(false);
  });

  it('receives the invocation JSON on stdin', async () => {
    const capture = join(cwd, 'cap.json');
    await runPreToolUseHooks([hook({ command: `cat - > "${capture}"` })], inv());
    const seen = JSON.parse(readFileSync(capture, 'utf8'));
    expect(seen).toMatchObject({ event: 'PreToolUse', toolName: 'Bash', detail: 'git push', sessionId: 's1' });
  });

  it('timeout kills and passes', async () => {
    const out = await runPreToolUseHooks([hook({ command: 'sleep 30', timeoutMs: 1000 })], inv());
    expect(out.blocked).toBe(false);
  }, 15_000);

  it('runs hooks in order and stops at the first block', async () => {
    const marker = join(cwd, 'second-ran');
    const out = await runPreToolUseHooks([
      hook({ command: 'exit 2' }),
      hook({ command: `touch "${marker}"` }),
    ], inv());
    expect(out.blocked).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });

  it('filters by matcher and skips invalid matchers', async () => {
    const ran = join(cwd, 'ran');
    await runPreToolUseHooks([
      hook({ matcher: 'Read', command: `touch "${ran}-wrongtool"` }),
      hook({ matcher: 'Bash(broken', command: `touch "${ran}-badmatcher"` }),
      hook({ matcher: 'Bash(git *)', command: `touch "${ran}-match"` }),
    ], inv());
    expect(existsSync(`${ran}-wrongtool`)).toBe(false);
    expect(existsSync(`${ran}-badmatcher`)).toBe(false);
    expect(existsSync(`${ran}-match`)).toBe(true);
  });
});

describe('runPostToolUseHooks', () => {
  it('PostToolUse collects exit-2 stderr as extra context', async () => {
    const extras = await runPostToolUseHooks([
      { event: 'PostToolUse', command: 'echo "tests now failing" >&2; exit 2' },
      { event: 'PostToolUse', command: 'exit 0' },
    ], inv({ event: 'PostToolUse' }));
    expect(extras).toEqual(['tests now failing']);
  });
});
