import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import type { Activity, ActivityResult } from '../types.js';

const execFileAsync = promisify(execFileCb);

export interface GitStageInput {
  worktreePath?: string;
  projectRootPath?: string;
}

export interface GitStageOutput extends Record<string, unknown> {
  stagedFiles: string[];
  count: number;
  hasChanges: boolean;
}

/**
 * Stages all changes (`git add -A`). Atomic leaf — never commits or calls another
 * Activity. Completes (not fails) on a clean tree; the empty case is handled by the
 * workflow's condition guard, not by failing here.
 */
export class GitStageActivity implements Activity<GitStageInput, GitStageOutput> {
  readonly type = 'git_stage';
  readonly name = 'Git Stage';
  readonly description = 'Stage all changes (git add -A)';
  readonly category = 'Git';
  readonly icon = 'GitBranch';
  readonly configSchema = { type: 'object', properties: {}, required: [] as string[] };

  async invoke(input: GitStageInput): Promise<ActivityResult<GitStageOutput>> {
    const cwd = input.worktreePath ?? input.projectRootPath;
    if (!cwd) {
      return { status: 'failed', output: { stagedFiles: [], count: 0, hasChanges: false }, error: 'No working directory' };
    }
    try {
      await execFileAsync('git', ['add', '-A'], { cwd });
      const { stdout } = await execFileAsync('git', ['diff', '--cached', '--name-only'], { cwd });
      const stagedFiles = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      return { status: 'completed', output: { stagedFiles, count: stagedFiles.length, hasChanges: stagedFiles.length > 0 } };
    } catch (err: unknown) {
      return {
        status: 'failed',
        output: { stagedFiles: [], count: 0, hasChanges: false },
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
