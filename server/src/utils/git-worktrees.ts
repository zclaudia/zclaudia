import { execSync } from 'child_process';
import * as path from 'path';

export interface GitWorktree {
  path: string; // absolute path
  branch: string; // branch name, e.g. 'main' or 'feat/foo'
  isMain: boolean; // whether this is the main worktree (the first one)
  commit?: string; // short HEAD commit hash
}

/**
 * List all worktrees of a git repository.
 * Returns an empty array when the directory is not a git repo or git is unavailable.
 */
export function listGitWorktrees(repoPath: string): GitWorktree[] {
  try {
    const output = execSync('git worktree list --porcelain', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });

    return parseWorktreeOutput(output);
  } catch {
    return [];
  }
}

/**
 * Parses `git worktree list --porcelain` output.
 *
 * Output format (one block per worktree, blocks separated by blank lines):
 *   worktree /absolute/path
 *   HEAD abc1234
 *   branch refs/heads/main
 *   (or a "detached" line instead of branch)
 */
function parseWorktreeOutput(output: string): GitWorktree[] {
  const blocks = output.trim().split(/\n\n+/);
  const result: GitWorktree[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block) continue;

    const lines = block.split('\n');
    let wtPath = '';
    let branch = '';
    let commit = '';

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        wtPath = line.slice('worktree '.length).trim();
      } else if (line.startsWith('HEAD ')) {
        commit = line.slice('HEAD '.length).trim().slice(0, 7);
      } else if (line.startsWith('branch ')) {
        // 'refs/heads/main' → 'main'
        branch = line
          .slice('branch '.length)
          .trim()
          .replace(/^refs\/heads\//, '');
      } else if (line === 'detached') {
        branch = `detached@${commit}`;
      }
    }

    if (!wtPath) continue;

    result.push({
      path: path.normalize(wtPath),
      branch: branch || commit || 'unknown',
      isMain: i === 0,
      commit,
    });
  }

  return result;
}

/**
 * Create a new git worktree.
 * - If the branch exists: `git worktree add <worktreePath> <branch>`
 * - If the branch does not exist: `git worktree add -b <branch> <worktreePath>`
 *
 * @returns the created GitWorktree
 * @throws when the git command fails
 */
export function createGitWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string
): GitWorktree {
  const absWorktreePath = path.isAbsolute(worktreePath)
    ? worktreePath
    : path.resolve(repoPath, worktreePath);

  // Check whether the branch already exists
  let branchExists = false;
  try {
    execSync(`git rev-parse --verify refs/heads/${branch}`, {
      cwd: repoPath,
      stdio: 'ignore',
      timeout: 5000,
    });
    branchExists = true;
  } catch {
    branchExists = false;
  }

  const cmd = branchExists
    ? `git worktree add "${absWorktreePath}" "${branch}"`
    : `git worktree add -b "${branch}" "${absWorktreePath}"`;

  execSync(cmd, {
    cwd: repoPath,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15000,
  });

  return {
    path: path.normalize(absWorktreePath),
    branch,
    isMain: false,
  };
}
