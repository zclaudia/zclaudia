import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  createAgentWorktree,
  cleanupAgentWorktree,
  isGitRepository,
} from '../agent-worktrees.js';

function git(cwd: string, cmd: string): string {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

describe('agent worktrees', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'zc-agentwt-'));
    git(repo, 'init -b main');
    git(repo, 'config user.email t@t.t');
    git(repo, 'config user.name t');
    writeFileSync(path.join(repo, 'README.md'), 'hello\n');
    git(repo, 'add .');
    git(repo, 'commit -m init');
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('detects git repositories', () => {
    expect(isGitRepository(repo)).toBe(true);
    const plain = mkdtempSync(path.join(tmpdir(), 'zc-plain-'));
    expect(isGitRepository(plain)).toBe(false);
    rmSync(plain, { recursive: true, force: true });
  });

  it('creates a worktree under .worktrees/agents with an agent branch', () => {
    const wt = createAgentWorktree(repo, 'task-1');
    expect(wt.path).toBe(path.join(repo, '.worktrees', 'agents', 'agent-task-1'));
    expect(wt.branch).toBe('agent/task-1');
    expect(existsSync(path.join(wt.path, 'README.md'))).toBe(true);
    // .worktrees/ is gitignored so agent dirs never show up as repo changes
    expect(readFileSync(path.join(repo, '.gitignore'), 'utf8')).toContain('.worktrees/');
  });

  it('does not duplicate an existing .gitignore entry', () => {
    writeFileSync(path.join(repo, '.gitignore'), '.worktrees/\n');
    createAgentWorktree(repo, 'task-2');
    const content = readFileSync(path.join(repo, '.gitignore'), 'utf8');
    expect(content.match(/\.worktrees\//g)).toHaveLength(1);
  });

  it('removes a clean worktree and its branch on cleanup', () => {
    const wt = createAgentWorktree(repo, 'task-3');
    const result = cleanupAgentWorktree(repo, wt);
    expect(result.removed).toBe(true);
    expect(existsSync(wt.path)).toBe(false);
    expect(() => git(repo, 'rev-parse --verify refs/heads/agent/task-3')).toThrow();
  });

  it('keeps a worktree with uncommitted changes', () => {
    const wt = createAgentWorktree(repo, 'task-4');
    writeFileSync(path.join(wt.path, 'new-file.txt'), 'work in progress\n');
    const result = cleanupAgentWorktree(repo, wt);
    expect(result.removed).toBe(false);
    expect(result.reason).toBe('has_changes');
    expect(existsSync(wt.path)).toBe(true);
  });

  it('keeps a worktree whose branch has unique commits', () => {
    const wt = createAgentWorktree(repo, 'task-5');
    writeFileSync(path.join(wt.path, 'feature.txt'), 'done\n');
    git(wt.path, 'add .');
    git(wt.path, 'commit -m feature');
    const result = cleanupAgentWorktree(repo, wt);
    expect(result.removed).toBe(false);
    expect(result.reason).toBe('has_commits');
    expect(existsSync(wt.path)).toBe(true);
    expect(git(repo, 'rev-parse --verify refs/heads/agent/task-5').trim()).toBeTruthy();
  });

  it('cleanup is safe to call twice', () => {
    const wt = createAgentWorktree(repo, 'task-6');
    expect(cleanupAgentWorktree(repo, wt).removed).toBe(true);
    const second = cleanupAgentWorktree(repo, wt);
    expect(second.removed).toBe(false);
    expect(second.reason).toBe('error');
  });
});
