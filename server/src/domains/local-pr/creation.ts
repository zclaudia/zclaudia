import type { LocalPR } from '@zclaudia/shared/features/local-pr';
import type { LocalPRContext } from './context.js';
import {
  getGitStatus,
  commitAllChanges,
  getNewCommits,
  getDiff,
  getMainBranch,
  getCurrentBranch,
  hasCommits,
} from '../../utils/git-operations.js';

export class PRCreationService {
  constructor(private ctx: LocalPRContext) {}

  /**
   * Validate whether a worktree is currently eligible for creating a local PR.
   * This is a non-mutating precheck for UI feedback.
   */
  async checkCreatePreconditions(
    projectId: string,
    worktreePath: string
  ): Promise<{ canCreate: boolean; reason?: string }> {
    const project = this.ctx.projectRepo.findById(projectId);
    if (!project?.rootPath) {
      return { canCreate: false, reason: `Project ${projectId} has no rootPath` };
    }

    const existing = this.ctx.prRepo.findActiveByWorktree(worktreePath);
    if (existing) {
      return {
        canCreate: false,
        reason: `An active local PR already exists for this worktree (id: ${existing.id})`,
      };
    }

    try {
      const baseBranch = await getMainBranch(worktreePath);
      const branchName = await getCurrentBranch(worktreePath);

      if (branchName === baseBranch) {
        return {
          canCreate: false,
          reason: `Worktree is already on the base branch (${baseBranch})`,
        };
      }

      if (!(await hasCommits(worktreePath))) {
        return {
          canCreate: false,
          reason: `Branch '${branchName}' has no commits yet`,
        };
      }

      const commits = await getNewCommits(project.rootPath, branchName, baseBranch);
      if (commits.length === 0) {
        return {
          canCreate: false,
          reason: `No new commits on branch '${branchName}' compared to '${baseBranch}'`,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate worktree';
      return { canCreate: false, reason: message };
    }

    return { canCreate: true };
  }

  /**
   * Create a Local PR for the given worktree path.
   * - Auto-commits any uncommitted changes
   * - Collects new commits vs base branch
   * - Stores diff summary
   */
  async createPR(
    projectId: string,
    worktreePath: string,
    options: {
      title?: string;
      description?: string;
      baseBranch?: string;
      autoTriggered?: boolean;
      autoReview?: boolean;
    } = {}
  ): Promise<LocalPR> {
    const project = this.ctx.projectRepo.findById(projectId);
    if (!project?.rootPath) {
      throw new Error(`Project ${projectId} has no rootPath`);
    }

    // Prevent duplicate active PRs for same worktree
    const existing = this.ctx.prRepo.findActiveByWorktree(worktreePath);
    if (existing) {
      throw new Error(`An active local PR already exists for this worktree (id: ${existing.id})`);
    }

    const baseBranch = options.baseBranch || (await getMainBranch(worktreePath));
    const branchName = await getCurrentBranch(worktreePath);

    if (branchName === baseBranch) {
      throw new Error(`Worktree is already on the base branch (${baseBranch})`);
    }

    // Auto-commit if there are uncommitted changes
    const status = await getGitStatus(worktreePath);
    if (status.hasChanges) {
      await commitAllChanges(worktreePath);
    }

    // Validate there are new commits
    const commits = await getNewCommits(project.rootPath, branchName, baseBranch);
    if (commits.length === 0) {
      throw new Error(`No new commits on branch '${branchName}' compared to '${baseBranch}'`);
    }

    const diffSummary = await getDiff(project.rootPath, baseBranch, branchName);

    const title =
      options.title ??
      (commits.length === 1 ? commits[0].message : `${branchName} (${commits.length} commits)`);

    // Atomic re-check + insert to prevent race conditions (async git ops above create a window)
    const pr = this.ctx.db.transaction(() => {
      const duplicate = this.ctx.prRepo.findActiveByWorktree(worktreePath);
      if (duplicate) return duplicate;

      return this.ctx.prRepo.create({
        projectId,
        worktreePath,
        branchName,
        baseBranch,
        title,
        description: options.description,
        status: 'open',
        commits: commits.map(c => c.sha),
        diffSummary,
        autoTriggered: options.autoTriggered ?? false,
        autoReview: options.autoReview ?? false,
        executionState: 'idle',
        pendingAction: 'none',
      });
    })();

    this.ctx.broadcastPRUpdate(pr);
    console.log(`[LocalPRService] Created PR ${pr.id} for branch '${branchName}'`);
    return pr;
  }

  /**
   * Called on `run.completed` for regular sessions with a working directory.
   * Only auto-creates a PR if the worktree has `autoCreatePR` enabled in its config.
   * If an active PR already exists and is safe to update, refreshes its commits/diff.
   */
  async maybeAutoCreatePR(projectId: string, worktreePath: string): Promise<LocalPR | null> {
    try {
      // Check worktree-level config
      const wtConfig = this.ctx.wtConfigRepo.findOne(projectId, worktreePath);
      if (!wtConfig?.autoCreatePR) return null;

      const project = this.ctx.projectRepo.findById(projectId);
      if (!project?.rootPath) return null;

      const baseBranch = await getMainBranch(worktreePath);
      const branchName = await getCurrentBranch(worktreePath);
      if (branchName === baseBranch) return null;

      const commits = await getNewCommits(project.rootPath, branchName, baseBranch);
      if (commits.length === 0) return null;

      // If an active PR already exists, try to update it
      const existing = this.ctx.prRepo.findActiveByWorktree(worktreePath);
      if (existing) {
        return this.ctx.maybeRefreshPR(existing, project.rootPath, commits, baseBranch, branchName);
      }

      return await this.createPR(projectId, worktreePath, {
        autoTriggered: true,
        autoReview: wtConfig.autoReview,
      });
    } catch (err) {
      console.error('[LocalPRService] maybeAutoCreatePR error:', err);
      return null;
    }
  }

  async maybeAutoCreatePRForCompletedSession(sessionId: string): Promise<LocalPR | null> {
    const session = this.ctx.sessionRepo.findRegularSessionWorktree(sessionId);
    if (!session) return null;
    return this.maybeAutoCreatePR(session.projectId, session.workingDirectory);
  }
}
