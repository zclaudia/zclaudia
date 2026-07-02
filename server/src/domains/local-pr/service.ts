import type { Database } from 'better-sqlite3';
import type { LocalPR } from '@zclaudia/shared/features/local-pr';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { LocalPRRepository } from './repository.js';
import { LocalPRContext, type LocalPRAIDeps } from './context.js';
import { PRCreationService } from './creation.js';
import { PRReviewService } from './review.js';
import { PRConflictService } from './conflict.js';
import { PRMergeService } from './merge.js';
import { PRQueueScheduler } from './scheduler.js';

export type { LocalPRAIDeps };

export class LocalPRService {
  private ctx: LocalPRContext;
  private creation: PRCreationService;
  private review: PRReviewService;
  private conflict: PRConflictService;
  private merge: PRMergeService;
  private scheduler: PRQueueScheduler;

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
    this.scheduler = new PRQueueScheduler(
      this.ctx,
      this.creation,
      this.review,
      this.merge,
      this.conflict
    );
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
  // Scheduler Tick (delegated to PRQueueScheduler)
  // ---------------------------------------------------------------------------

  tick(): Promise<void> {
    return this.scheduler.tick();
  }

  // Private delegators retained so the service test-suite (which reaches these
  // via `service as any`) keeps observing the same behaviour now that the
  // scheduler tick logic lives on PRQueueScheduler.
  private processQueue(): Promise<void> {
    return this.scheduler.processQueue();
  }

  private processFailed(): Promise<void> {
    return this.scheduler.processFailed();
  }

  private processStale(): Promise<void> {
    return this.scheduler.processStale();
  }

  private cleanupFinishedPRs(): Promise<void> {
    return this.scheduler.cleanupFinishedPRs();
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
