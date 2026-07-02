import type { LocalPRStatus } from '@zclaudia/shared/features/local-pr';
import type { LocalPRContext } from './context.js';
import type { PRConflictService } from './conflict.js';
import { resolveMergeCommitSha } from './merge-commit.js';
import { isWorkingTreeClean, mergeBranch, abortMerge } from '../../utils/git-operations.js';

export class PRMergeService {
  constructor(
    private ctx: LocalPRContext,
    private conflict: PRConflictService
  ) {}

  /**
   * Attempt to merge an approved PR into the base branch.
   * Uses a mutex to serialize all merge operations.
   */
  async mergePR(prId: string): Promise<void> {
    const pr = this.ctx.prRepo.findById(prId);
    if (!pr) throw new Error(`Local PR not found: ${prId}`);

    const project = this.ctx.projectRepo.findById(pr.projectId);
    if (!project?.rootPath) throw new Error(`Project ${pr.projectId} has no rootPath`);
    const projectRoot = project.rootPath;

    return this.ctx.mergeLock.runExclusive(async () => {
      // Re-fetch inside lock to ensure status hasn't changed
      const freshPR = this.ctx.prRepo.findById(prId);
      if (!freshPR) throw new Error(`Local PR not found: ${prId}`);
      if (!['open', 'approved', 'conflict'].includes(freshPR.status)) {
        throw new Error(`Cannot merge PR in status '${freshPR.status}'`);
      }

      if (!this.ctx.hasAvailableSlot(freshPR.projectId)) {
        const queuedStatus: LocalPRStatus = freshPR.status === 'open' ? 'approved' : freshPR.status;
        this.ctx.prRepo.update(prId, {
          status: queuedStatus,
          statusMessage: 'Queued for merge: waiting for an available worktree slot.',
          executionState: 'queued',
          pendingAction: 'merge',
        });
        this.ctx.broadcastPRUpdate(this.ctx.requirePR(prId));
        return;
      }

      // Has slot - mark as running
      this.ctx.prRepo.update(prId, {
        executionState: 'running',
        pendingAction: 'merge',
      });

      // Manual merge from open/conflict should go through approved -> merging transition.
      if (freshPR.status !== 'approved') {
        this.ctx.prRepo.update(prId, {
          status: 'approved',
          statusMessage: 'Merge requested. Preparing to merge...',
        });
        this.ctx.broadcastPRUpdate(this.ctx.requirePR(prId));
      }

      // Verify main worktree is clean
      const mainClean = await isWorkingTreeClean(projectRoot);
      if (!mainClean) {
        this.ctx.prRepo.update(prId, {
          status: 'approved',
          statusMessage:
            'Cannot merge: main worktree is dirty. Commit or stash changes, then retry.',
          executionState: 'idle',
          pendingAction: 'none',
        });
        this.ctx.broadcastPRUpdate(this.ctx.requirePR(prId));
        throw new Error(
          `Main worktree is dirty for project ${project.id}. Commit or stash changes before merging PR ${prId}.`
        );
      }

      this.ctx.prRepo.update(prId, {
        status: 'merging',
        statusMessage: `Merging '${pr.branchName}' into '${pr.baseBranch}'...`,
      });
      this.ctx.broadcastPRUpdate(this.ctx.requirePR(prId));

      try {
        // Checkout base branch in main worktree
        const { execFile: execFileCb } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFileCb);
        await execFileAsync('git', ['checkout', pr.baseBranch], { cwd: projectRoot });

        const result = await mergeBranch(projectRoot, pr.branchName, `Merge Local PR: ${pr.title}`);

        if (result.success) {
          const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
            cwd: projectRoot,
          });
          const mergeCommitSha = stdout.trim();
          this.ctx.prRepo.update(prId, {
            status: 'merged',
            mergedAt: Date.now(),
            statusMessage: `Merged into '${pr.baseBranch}'.`,
            mergeCommitSha,
            executionState: 'idle',
            pendingAction: 'none',
          });
          const mergedPR = this.ctx.requirePR(prId);
          this.ctx.broadcastPRUpdate(mergedPR);
          this.ctx.archiveRelatedSessions(mergedPR);
          console.log(`[LocalPRService] Merged PR ${prId} into ${pr.baseBranch}`);
        } else {
          console.warn(
            `[LocalPRService] Merge conflict for PR ${prId}: ${result.conflicts?.join(', ')}`
          );
          await abortMerge(projectRoot);
          this.ctx.prRepo.update(prId, {
            status: 'conflict',
            statusMessage: `Merge conflict detected. Resolve conflicts and retry merge, or start AI conflict resolution.`,
            executionState: 'idle',
            pendingAction: 'none',
          });
          this.ctx.broadcastPRUpdate(this.ctx.requirePR(prId));
          await this.conflict.startConflictResolution(prId);
        }
      } catch (err) {
        console.error(`[LocalPRService] Merge error for PR ${prId}:`, err);
        const message = err instanceof Error ? err.message : 'Unknown merge error';
        this.ctx.prRepo.update(prId, {
          status: 'approved',
          statusMessage: `Merge failed: ${message}`,
          executionState: 'failed',
          executionError: message,
        }); // reset so it can retry
        this.ctx.broadcastPRUpdate(this.ctx.requirePR(prId));

        // Check for commits that arrived during the merge attempt
        await this.ctx.refreshAfterBusyState(prId);
        throw err;
      }
    });
  }

  /** Force-cancel a stuck merge and return PR back to approved state for retry. */
  async cancelMerge(prId: string): Promise<void> {
    const pr = this.ctx.prRepo.findById(prId);
    if (!pr) throw new Error(`Local PR not found: ${prId}`);
    if (pr.status !== 'merging') throw new Error(`Cannot cancel merge in status '${pr.status}'`);

    const project = this.ctx.projectRepo.findById(pr.projectId);
    if (!project?.rootPath) throw new Error(`Project ${pr.projectId} has no rootPath`);
    const projectRoot = project.rootPath;

    await this.ctx.mergeLock.runExclusive(async () => {
      try {
        await abortMerge(projectRoot);
      } catch {
        // Best-effort abort; status reset still helps unblock UI.
      }
      this.ctx.prRepo.update(prId, {
        status: 'approved',
        statusMessage: 'Merge cancelled manually. You can retry merge.',
      });
      this.ctx.broadcastPRUpdate(this.ctx.requirePR(prId));
      await this.ctx.refreshAfterBusyState(prId);
    });
  }

  /** Reopen a closed PR back to open state. */
  async reopenPR(prId: string): Promise<void> {
    const pr = this.ctx.prRepo.findById(prId);
    if (!pr) throw new Error(`Local PR not found: ${prId}`);
    if (pr.status !== 'closed') throw new Error(`Cannot reopen PR in status '${pr.status}'`);

    this.ctx.prRepo.update(prId, {
      status: 'open',
      statusMessage: 'PR reopened. Ready for review or merge.',
    });
    this.ctx.broadcastPRUpdate(this.ctx.requirePR(prId));
  }

  /** Revert a merged PR by reverting its merge commit on base branch. */
  async revertMergedPR(prId: string): Promise<void> {
    const pr = this.ctx.prRepo.findById(prId);
    if (!pr) throw new Error(`Local PR not found: ${prId}`);
    if (pr.status !== 'merged') throw new Error(`Cannot revert PR in status '${pr.status}'`);

    const project = this.ctx.projectRepo.findById(pr.projectId);
    if (!project?.rootPath) throw new Error(`Project ${pr.projectId} has no rootPath`);
    const projectRoot = project.rootPath;

    await this.ctx.mergeLock.runExclusive(async () => {
      const { execFile: execFileCb } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFileCb);

      const mainClean = await isWorkingTreeClean(projectRoot);
      if (!mainClean) {
        throw new Error(
          `Main worktree is dirty for project ${project.id}. Commit or stash changes before reverting PR ${prId}.`
        );
      }

      const mergeCommitSha = await resolveMergeCommitSha(pr, projectRoot, execFileAsync);
      if (!mergeCommitSha) {
        throw new Error(`Cannot determine merge commit for PR ${prId}`);
      }

      try {
        await execFileAsync('git', ['checkout', pr.baseBranch], { cwd: projectRoot });
        await execFileAsync('git', ['revert', '-m', '1', mergeCommitSha, '--no-edit'], {
          cwd: projectRoot,
        });
        this.ctx.prRepo.update(prId, {
          status: 'closed',
          statusMessage: `Merge reverted successfully (${mergeCommitSha.slice(0, 8)}).`,
        });
        this.ctx.broadcastPRUpdate(this.ctx.requirePR(prId));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown revert error';
        this.ctx.prRepo.update(prId, {
          status: 'merged',
          statusMessage: `Revert failed: ${message}`,
        });
        this.ctx.broadcastPRUpdate(this.ctx.requirePR(prId));
        throw err;
      }
    });
  }
}
