import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import type { Activity, ActivityResult } from '../types.js';

const execFileAsync = promisify(execFileCb);

export interface GitCommitInput {
  worktreePath?: string;
  projectRootPath?: string;
  stageAll?: boolean;
  messageMode?: 'stat' | 'explicit';
  message?: string;
}

export interface GitCommitOutput extends Record<string, unknown> {
  commitSha: string | null;
  message: string;
}

/**
 * Stages (by default) and commits. Atomic leaf — it never generates a message
 * or calls another Activity. AI messages arrive as `messageMode: 'explicit'`
 * produced upstream (panel flow, or the sub-project-3 workflow).
 */
export class GitCommitActivity implements Activity<GitCommitInput, GitCommitOutput> {
  readonly type = 'git_commit';
  readonly name = 'Git Commit';
  readonly description = 'Stage (by default) and commit changes';
  readonly category = 'Git';
  readonly icon = 'GitCommit';
  readonly supportsLoop = true;
  readonly configSchema = {
    type: 'object',
    properties: {
      stageAll: { type: 'boolean', description: 'Run git add -A before committing (default true)' },
      messageMode: {
        type: 'string',
        enum: ['stat', 'explicit'],
        description: 'stat = auto summary; explicit = use message field',
      },
      message: {
        type: 'string',
        description: 'Commit message (used when messageMode is explicit)',
      },
    },
    required: [] as string[],
  };

  async invoke(input: GitCommitInput): Promise<ActivityResult<GitCommitOutput>> {
    const cwd = input.worktreePath ?? input.projectRootPath;
    if (!cwd) {
      return {
        status: 'failed',
        output: { commitSha: null, message: '' },
        error: 'No working directory',
      };
    }

    const stageAll = input.stageAll ?? true;
    const messageMode = input.messageMode ?? (input.message ? 'explicit' : 'stat');

    try {
      const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd });
      if (!status.trim()) {
        return {
          status: 'completed',
          output: { commitSha: null, message: 'No changes to commit' },
        };
      }

      if (stageAll) {
        await execFileAsync('git', ['add', '-A'], { cwd });
      }

      // Always compute the stat — matches the original GitStepExecutor.handleGitCommit
      // git-call sequence; used for the stat-mode message.
      const { stdout: diffStat } = await execFileAsync('git', ['diff', '--cached', '--stat'], {
        cwd,
      });

      let message: string;
      if (messageMode === 'explicit') {
        const explicit = (input.message ?? '').trim();
        if (!explicit) {
          return {
            status: 'failed',
            output: { commitSha: null, message: '' },
            error: 'No commit message provided',
          };
        }
        message = explicit;
      } else {
        message = `auto: ${(diffStat.trim().split('\n').pop() ?? 'changes').trim()}`;
      }

      await execFileAsync('git', ['commit', '-m', message], { cwd });
      const { stdout: sha } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd });
      return { status: 'completed', output: { commitSha: sha.trim(), message } };
    } catch (err: unknown) {
      return {
        status: 'failed',
        output: { commitSha: null, message: '' },
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
