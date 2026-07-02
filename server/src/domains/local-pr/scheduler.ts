import type { LocalPRStatus } from '@zclaudia/shared/features/local-pr';
import { removeWorktree } from '../../utils/git-operations.js';
import type { LocalPRContext } from './context.js';
import type { PRCreationService } from './creation.js';
import type { PRReviewService } from './review.js';
import type { PRMergeService } from './merge.js';
import type { PRConflictService } from './conflict.js';

// How long (ms) before a reviewing/merging PR is considered stale and reset
const STALE_TIMEOUT_MS = 30 * 60 * 1000;

// Maximum number of merged/closed PRs to keep per project
const MAX_FINISHED_PRS_PER_PROJECT = 10;

/**
 * Owns the periodic scheduler tick: draining the queue, retrying failed PRs,
 * resetting stale in-progress PRs, and cleaning up old finished PRs.
 */
export class PRQueueScheduler {
  constructor(
    private ctx: LocalPRContext,
    private creation: PRCreationService,
    private review: PRReviewService,
    private merge: PRMergeService,
    private conflict: PRConflictService
  ) {}

  async tick(): Promise<void> {
    try {
      await this.processStale();
      await this.processQueue();
      await this.processFailed();
      await this.cleanupFinishedPRs();
    } catch (err) {
      console.error('[LocalPRService] tick error:', err);
    }
  }

  /**
   * Process queued PRs - start execution when slot becomes available.
   */
  async processQueue(): Promise<void> {
    const queued = this.ctx.prRepo.findQueued();

    for (const pr of queued) {
      // Check if slot is available
      if (!this.ctx.hasAvailableSlot(pr.projectId)) continue;

      // Check if already running
      if (pr.pendingAction === 'review' && this.ctx.activeReviewIds.has(pr.id)) continue;
      if (pr.pendingAction === 'merge' && this.ctx.mergeLock.isLocked()) continue;

      console.log(`[LocalPRService] Starting queued PR ${pr.id} (${pr.pendingAction})`);

      // Mark as running and start the action
      this.ctx.prRepo.update(pr.id, { executionState: 'running' });

      try {
        switch (pr.pendingAction) {
          case 'review':
            await this.review.startReview(pr.id);
            break;
          case 'merge':
            await this.merge.mergePR(pr.id);
            break;
          case 'resolve_conflict':
            await this.conflict.startConflictResolution(pr.id);
            break;
        }
      } catch (err) {
        console.error(`[LocalPRService] Failed to start queued PR ${pr.id}:`, err);
      }
    }
  }

  /**
   * Retry failed PRs that are eligible for retry.
   */
  async processFailed(): Promise<void> {
    const failed = this.ctx.prRepo.findFailed();

    for (const pr of failed) {
      // Check if slot is available
      if (!this.ctx.hasAvailableSlot(pr.projectId)) continue;

      console.log(`[LocalPRService] Retrying failed PR ${pr.id}`);

      // Reset to queued for retry
      this.ctx.prRepo.update(pr.id, {
        executionState: 'queued',
        executionError: undefined,
      });

      // Will be picked up by processQueue in next tick
    }
  }

  /** Reset stale reviewing/merging PRs that have been stuck for too long. */
  async processStale(): Promise<void> {
    const threshold = Date.now() - STALE_TIMEOUT_MS;
    const stale = this.ctx.prRepo.findInProgress().filter(pr => pr.updatedAt < threshold);

    for (const pr of stale) {
      const resetStatus: LocalPRStatus = pr.status === 'reviewing' ? 'open' : 'approved';
      this.ctx.prRepo.update(pr.id, {
        status: resetStatus,
        statusMessage: `Auto-reset stale ${pr.status} state.`,
        executionState: 'idle',
        pendingAction: 'none',
      });
      this.ctx.activeReviewIds.delete(pr.id);
      this.ctx.broadcastPRUpdate(this.ctx.requirePR(pr.id));
      console.log(`[LocalPRService] Reset stale PR ${pr.id} (${pr.status} → ${resetStatus})`);
      await this.ctx.refreshAfterBusyState(pr.id);
    }
  }

  private async processPendingReviews(): Promise<void> {
    // Only auto-review PRs that have auto_review enabled
    const pending = this.ctx.prRepo.findPendingAutoReview();

    for (const pr of pending) {
      if (this.ctx.activeReviewIds.has(pr.id)) continue; // already running

      await this.review
        .startReview(pr.id)
        .catch(err =>
          console.error(`[LocalPRService] Failed to start review for PR ${pr.id}:`, err)
        );
    }
  }

  private async processPendingMerges(): Promise<void> {
    const pending = this.ctx.prRepo.findPendingMerge();

    for (const pr of pending) {
      await this.merge
        .mergePR(pr.id)
        .catch(err => console.error(`[LocalPRService] Failed to merge PR ${pr.id}:`, err));
    }
  }

  /**
   * Remove old merged/closed PRs beyond the retention limit per project.
   * Cleans up: git worktree, git branch, related sessions, and DB record.
   */
  async cleanupFinishedPRs(): Promise<void> {
    const projects = this.ctx.projectRepo.findAll();

    for (const project of projects) {
      const allPRs = this.ctx.prRepo.findByProjectId(project.id);
      // Keep only merged/closed, sorted newest first (findByProjectId already orders by created_at DESC)
      const finished = allPRs.filter(pr => pr.status === 'merged' || pr.status === 'closed');
      if (finished.length <= MAX_FINISHED_PRS_PER_PROJECT) continue;

      const toRemove = finished.slice(MAX_FINISHED_PRS_PER_PROJECT);
      for (const pr of toRemove) {
        try {
          // Clean up git worktree + branch
          if (project.rootPath && pr.worktreePath) {
            await removeWorktree(project.rootPath, pr.worktreePath, pr.branchName);
          }
          // Delete related sessions from DB
          this.ctx.deleteRelatedSessions(pr);
          // Delete PR record
          this.ctx.prRepo.delete(pr.id);
          // Notify frontend to remove this PR
          this.ctx.broadcastToProject(pr.projectId, {
            type: 'local_pr_deleted',
            projectId: pr.projectId,
            prId: pr.id,
          });
          console.log(`[LocalPRService] Cleaned up old PR ${pr.id} (${pr.status}: ${pr.title})`);
        } catch (err) {
          console.warn(`[LocalPRService] Failed to cleanup PR ${pr.id}:`, err);
        }
      }
    }
  }
}
