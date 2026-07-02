/**
 * Ephemeral git worktrees for isolated subagent tasks.
 *
 * Unlike the supervision worktree pool (bounded slots with merge-back
 * semantics under .worktrees/supervision/), agent worktrees are throwaway:
 * one per task under .worktrees/agents/, auto-removed when the agent left no
 * changes and kept (with branch agent/{taskId}) when it did, so the user can
 * inspect or merge the work. Built on the same git primitives as the rest of
 * the worktree stack (utils/git-worktrees.ts).
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createGitWorktree } from './git-worktrees.js';

export const AGENT_WORKTREES_DIR = path.join('.worktrees', 'agents');
export const SESSION_WORKTREES_DIR = path.join('.worktrees', 'sessions');

export interface AgentWorktree {
  path: string;
  branch: string;
}

export interface AgentWorktreeCleanup {
  removed: boolean;
  reason: 'clean' | 'has_changes' | 'has_commits' | 'error';
}

function git(cwd: string, cmd: string): string {
  return execSync(`git ${cmd}`, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15000,
  });
}

export function isGitRepository(rootPath: string): boolean {
  try {
    execSync('git rev-parse --git-dir', { cwd: rootPath, stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Same convention as ProjectWorktreeService: keep .worktrees/ out of the index. */
function ensureWorktreesIgnored(rootPath: string): void {
  const gitignorePath = path.join(rootPath, '.gitignore');
  const entry = '.worktrees/';
  try {
    if (fs.existsSync(gitignorePath)) {
      const lines = fs
        .readFileSync(gitignorePath, 'utf-8')
        .split('\n')
        .map(line => line.trim());
      if (!lines.includes(entry) && !lines.includes('.worktrees')) {
        fs.appendFileSync(gitignorePath, `\n${entry}\n`);
      }
    } else {
      fs.writeFileSync(gitignorePath, `${entry}\n`);
    }
  } catch {
    // best-effort: a missing ignore entry is cosmetic, not fatal
  }
}

export function agentWorktreeBranch(taskId: string): string {
  return `agent/${taskId}`;
}

export function createAgentWorktree(rootPath: string, taskId: string): AgentWorktree {
  ensureWorktreesIgnored(rootPath);
  const worktreePath = path.join(rootPath, AGENT_WORKTREES_DIR, `agent-${taskId}`);
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  const branch = agentWorktreeBranch(taskId);
  const created = createGitWorktree(rootPath, worktreePath, branch);
  return { path: created.path, branch };
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'wt'
  );
}

/**
 * Create a named worktree for a main session under .worktrees/sessions/.
 * Same disposable semantics as agent worktrees; the slug derives the branch.
 */
export function createSessionWorktree(rootPath: string, name: string): AgentWorktree {
  ensureWorktreesIgnored(rootPath);
  const slug = slugify(name);
  const worktreePath = path.join(rootPath, SESSION_WORKTREES_DIR, slug);
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  const branch = `worktree/${slug}`;
  const created = createGitWorktree(rootPath, worktreePath, branch);
  return { path: created.path, branch };
}

/** Best-effort current branch of a worktree (for ExitWorktree cleanup). */
export function worktreeBranch(worktreePath: string): string | undefined {
  try {
    const branch = git(worktreePath, 'rev-parse --abbrev-ref HEAD').trim();
    return branch && branch !== 'HEAD' ? branch : undefined;
  } catch {
    return undefined;
  }
}

/** Commits reachable only from this branch (not from any other branch or tag). */
function uniqueCommitCount(rootPath: string, branch: string): number {
  // --exclude globs match without the refs/heads/ prefix and apply to the
  // next --branches only; tags can't shadow the agent branch anyway.
  const output = git(
    rootPath,
    `rev-list --count refs/heads/${branch} --not --exclude=${branch} --branches --tags`
  );
  return Number.parseInt(output.trim(), 10) || 0;
}

/**
 * Remove the worktree and its branch when the agent left no trace; keep both
 * when there are uncommitted changes or commits unique to the agent branch.
 */
export function cleanupAgentWorktree(
  rootPath: string,
  worktree: AgentWorktree
): AgentWorktreeCleanup {
  try {
    if (git(worktree.path, 'status --porcelain').trim().length > 0) {
      return { removed: false, reason: 'has_changes' };
    }
    if (uniqueCommitCount(rootPath, worktree.branch) > 0) {
      return { removed: false, reason: 'has_commits' };
    }
    git(rootPath, `worktree remove --force "${worktree.path}"`);
    try {
      git(rootPath, `branch -D ${worktree.branch}`);
    } catch {
      // detached or already deleted — the worktree itself is gone, good enough
    }
    return { removed: true, reason: 'clean' };
  } catch {
    return { removed: false, reason: 'error' };
  }
}
