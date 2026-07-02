/**
 * Git Step Executors — git_merge, create_worktree, create_pr.
 */

import type { StepExecutorPort, StepResult, StepContext } from '../ports/step-executor.js';
import type { WorkflowNodeDef } from '@zclaudia/shared/features/workflows';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFileCb);

export class GitStepExecutor implements StepExecutorPort {
  readonly supportedTypes = ['git_merge', 'create_worktree', 'create_pr'] as const;

  async execute(
    node: WorkflowNodeDef,
    config: Record<string, unknown>,
    ctx: StepContext
  ): Promise<StepResult> {
    switch (node.type) {
      case 'git_merge':
        return this.handleGitMerge(config, ctx);
      case 'create_worktree':
        return this.handleCreateWorktree(config, ctx);
      case 'create_pr':
        return this.handleCreatePR(config, ctx);
      default:
        return { status: 'failed', output: {}, error: `Unknown git step type: ${node.type}` };
    }
  }

  private async handleGitMerge(
    config: Record<string, unknown>,
    ctx: StepContext
  ): Promise<StepResult> {
    const branch = config.branch as string;
    if (!branch) return { status: 'failed', output: {}, error: 'No branch specified' };

    const baseBranch = (config.baseBranch as string) ?? 'main';
    const cwd = (config.worktreePath as string) ?? ctx.projectRootPath;
    if (!cwd) return { status: 'failed', output: {}, error: 'No working directory' };

    try {
      await execFileAsync('git', ['checkout', baseBranch], { cwd });
      await execFileAsync('git', ['merge', branch, '--no-ff', '-m', `Merge branch '${branch}'`], {
        cwd,
      });
      return { status: 'completed', output: { success: true, branch, baseBranch } };
    } catch (err: unknown) {
      try {
        const { stdout } = await execFileAsync('git', ['diff', '--name-only', '--diff-filter=U'], {
          cwd,
        });
        if (stdout.trim()) {
          await execFileAsync('git', ['merge', '--abort'], { cwd });
          return {
            status: 'failed',
            output: { success: false, conflicts: stdout.trim().split('\n') },
            error: 'Merge conflicts detected',
          };
        }
      } catch {
        /* ignore */
      }
      return {
        status: 'failed',
        output: {},
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async handleCreateWorktree(
    config: Record<string, unknown>,
    ctx: StepContext
  ): Promise<StepResult> {
    const branchName = config.branchName as string;
    if (!branchName) return { status: 'failed', output: {}, error: 'No branch name specified' };

    const cwd = ctx.projectRootPath;
    if (!cwd) return { status: 'failed', output: {}, error: 'No project root path' };

    const baseBranch = (config.baseBranch as string) ?? 'main';
    const worktreePath = `${cwd}/../${branchName}`;

    try {
      await execFileAsync('git', ['worktree', 'add', '-b', branchName, worktreePath, baseBranch], {
        cwd,
      });
      return { status: 'completed', output: { worktreePath, branch: branchName } };
    } catch (err: unknown) {
      return {
        status: 'failed',
        output: {},
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async handleCreatePR(
    config: Record<string, unknown>,
    ctx: StepContext
  ): Promise<StepResult> {
    const worktreePath = (config.worktreePath as string) ?? ctx.projectRootPath;
    if (!worktreePath) return { status: 'failed', output: {}, error: 'No working directory' };

    try {
      const { stdout: branchName } = await execFileAsync(
        'git',
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        { cwd: worktreePath }
      );
      const branch = branchName.trim();
      const title = (config.title as string) ?? `PR: ${branch}`;
      const description = (config.description as string) ?? '';
      const baseBranch = (config.baseBranch as string) ?? 'main';
      const { stdout: diffStat } = await execFileAsync(
        'git',
        ['diff', `${baseBranch}...${branch}`, '--stat'],
        { cwd: worktreePath }
      );

      return {
        status: 'completed',
        output: {
          title,
          description,
          branchName: branch,
          baseBranch,
          diffSummary: diffStat.trim(),
        },
      };
    } catch (err: unknown) {
      return {
        status: 'failed',
        output: {},
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
