import type { Database } from 'better-sqlite3';
import type { LocalPR, LocalPRStatus } from '@zclaudia/shared/features/local-pr';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { LocalPRRepository } from './repository.js';
import { LocalPRContext, type LocalPRAIDeps } from './context.js';
import { PRCreationService } from './creation.js';
import { PRReviewService } from './review.js';
import { PRConflictService } from './conflict.js';
import { PRMergeService } from './merge.js';
import { removeWorktree } from '../../utils/git-operations.js';

export type { LocalPRAIDeps };

// How long (ms) before a reviewing/merging PR is considered stale and reset
const STALE_TIMEOUT_MS = 30 * 60 * 1000;

// Maximum number of merged/closed PRs to keep per project
const MAX_FINISHED_PRS_PER_PROJECT = 10;

export class LocalPRService {
  private ctx: LocalPRContext;
  private creation: PRCreationService;
  private review: PRReviewService;
  private conflict: PRConflictService;
  private merge: PRMergeService;

  constructor(
    db: Database,
    broadcastToProject: (projectId: string, message: ServerMessage) => void,
    deps?: LocalPRAIDeps | ((projectId: string) => boolean)
  ) {
    // Backward compat: accept a bare function as isProjectSlotAvailable
    const aiDeps: LocalPRAIDeps | undefined =
      typeof deps === 'function'
        ? {
            startAISession: () => {
              throw new Error('AI session not configured');
            },
            isProjectSlotAvailable: deps,
          }
        : deps;
    this.ctx = new LocalPRContext(db, broadcastToProject, aiDeps);
    this.creation = new PRCreationService(this.ctx);
    this.review = new PRReviewService(this.ctx);
    this.conflict = new PRConflictService(this.ctx);
    this.merge = new PRMergeService(this.ctx, this.conflict);
  }

  // ---------------------------------------------------------------------------
  // PR Creation (delegated to PRCreationService)
  // ---------------------------------------------------------------------------

  checkCreatePreconditions(
    projectId: string,
    worktreePath: string
  ): Promise<{ canCreate: boolean; reason?: string }> {
    return this.creation.checkCreatePreconditions(projectId, worktreePath);
  }

  createPR(
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
    return this.creation.createPR(projectId, worktreePath, options);
  }

  maybeAutoCreatePR(projectId: string, worktreePath: string): Promise<LocalPR | null> {
    return this.creation.maybeAutoCreatePR(projectId, worktreePath);
  }

  maybeAutoCreatePRForCompletedSession(sessionId: string): Promise<LocalPR | null> {
    return this.creation.maybeAutoCreatePRForCompletedSession(sessionId);
  }

  // ---------------------------------------------------------------------------
  // Review
  // ---------------------------------------------------------------------------

  /**
   * Start an AI review session for the given PR.
   * @param prId - The local PR to review
   * @param overrideProviderId - Optional provider ID (for manual trigger). Falls back to project.reviewLlmProfileId → project.defaultAgentProfileId.
   */
  startReview(prId: string, overrideProviderId?: string): Promise<void> {
    return this.review.startReview(prId, overrideProviderId);
  }

  // Private delegators retained so the service test-suite (which reaches these
  // via `service as any`) keeps observing the same behaviour now that it lives
  // on PRReviewService.
  private onReviewSessionComplete(
    prId: string,
    sessionId: string,
    runFailed = false
  ): Promise<void> {
    return this.review.onReviewSessionComplete(prId, sessionId, runFailed);
  }

  private cleanupReviewArtifacts(pr: LocalPR): Promise<void> {
    return this.review.cleanupReviewArtifacts(pr);
  }

  // ---------------------------------------------------------------------------
  // Merge
  // ---------------------------------------------------------------------------

  /**
   * Attempt to merge an approved PR into the base branch.
   * Uses a mutex to serialize all merge operations.
   */
  mergePR(prId: string): Promise<void> {
    return this.merge.mergePR(prId);
  }

  /** Force-cancel a stuck merge and return PR back to approved state for retry. */
  cancelMerge(prId: string): Promise<void> {
    return this.merge.cancelMerge(prId);
  }

  /** Manually trigger AI conflict-resolution session for a conflict PR. */
  triggerConflictResolution(prId: string): Promise<void> {
    return this.conflict.triggerConflictResolution(prId);
  }

  /** Reopen a closed PR back to open state. */
  reopenPR(prId: string): Promise<void> {
    return this.merge.reopenPR(prId);
  }

  /** Revert a merged PR by reverting its merge commit on base branch. */
  revertMergedPR(prId: string): Promise<void> {
    return this.merge.revertMergedPR(prId);
  }

  // ---------------------------------------------------------------------------
  // Conflict Resolution
  // ---------------------------------------------------------------------------

  /**
   * Start an AI session to resolve merge conflicts for the given PR.
   * The AI rebases the feature branch onto the base branch in the feature worktree.
   * Merge is left to the normal mergePR flow after re-review.
   */
  startConflictResolution(prId: string, overrideProviderId?: string): Promise<void> {
    return this.conflict.startConflictResolution(prId, overrideProviderId);
  }

  // Private delegator retained so the service test-suite (which reaches this
  // via `service as any`) keeps observing the same behaviour now that it lives
  // on PRConflictService.
  private onConflictSessionComplete(prId: string, sessionId: string): Promise<void> {
    return this.conflict.onConflictSessionComplete(prId, sessionId);
  }

  // ---------------------------------------------------------------------------
  // Scheduler Tick
  // ---------------------------------------------------------------------------

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
  private async processQueue(): Promise<void> {
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
            await this.startReview(pr.id);
            break;
          case 'merge':
            await this.mergePR(pr.id);
            break;
          case 'resolve_conflict':
            await this.startConflictResolution(pr.id);
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
  private async processFailed(): Promise<void> {
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
  private async processStale(): Promise<void> {
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

      await this.startReview(pr.id).catch(err =>
        console.error(`[LocalPRService] Failed to start review for PR ${pr.id}:`, err)
      );
    }
  }

  private async processPendingMerges(): Promise<void> {
    const pending = this.ctx.prRepo.findPendingMerge();

    for (const pr of pending) {
      await this.mergePR(pr.id).catch(err =>
        console.error(`[LocalPRService] Failed to merge PR ${pr.id}:`, err)
      );
    }
  }

  /**
   * Remove old merged/closed PRs beyond the retention limit per project.
   * Cleans up: git worktree, git branch, related sessions, and DB record.
   */
  private async cleanupFinishedPRs(): Promise<void> {
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

  // ---------------------------------------------------------------------------
  // Facade delegators
  // ---------------------------------------------------------------------------

  // Expose repository for route handlers
  getRepo(): LocalPRRepository {
    return this.ctx.prRepo;
  }

  archiveRelatedSessions(pr: LocalPR): void {
    return this.ctx.archiveRelatedSessions(pr);
  }

  // Internal delegators to context state/helpers. Retained so existing callers
  // and the service test-suite (which reaches these via `service as any`) keep
  // observing the same shared state/behaviour now that it lives on the context.
  private get llmProfileRepo(): LocalPRContext['llmProfileRepo'] {
    return this.ctx.llmProfileRepo;
  }

  private get activeConflictIds(): LocalPRContext['activeConflictIds'] {
    return this.ctx.activeConflictIds;
  }

  private maybeRefreshPR(
    ...args: Parameters<LocalPRContext['maybeRefreshPR']>
  ): ReturnType<LocalPRContext['maybeRefreshPR']> {
    return this.ctx.maybeRefreshPR(...args);
  }

  private refreshAfterBusyState(
    ...args: Parameters<LocalPRContext['refreshAfterBusyState']>
  ): ReturnType<LocalPRContext['refreshAfterBusyState']> {
    return this.ctx.refreshAfterBusyState(...args);
  }

  private deleteRelatedSessions(pr: LocalPR): void {
    return this.ctx.deleteRelatedSessions(pr);
  }

  private broadcastPRUpdate(pr: LocalPR): void {
    return this.ctx.broadcastPRUpdate(pr);
  }

  private forwardSessionStream(projectId: string, sessionId: string, msg: ServerMessage): void {
    return this.ctx.forwardSessionStream(projectId, sessionId, msg);
  }

  private hasAvailableSlot(projectId: string): boolean {
    return this.ctx.hasAvailableSlot(projectId);
  }
}
