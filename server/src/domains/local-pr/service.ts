import type { Database } from 'better-sqlite3';
import type { LocalPR, LocalPRStatus } from '@zclaudia/shared/features/local-pr';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { LocalPRRepository } from './repository.js';
import { buildConflictResolutionPrompt } from './conflict-resolution-prompt.js';
import { resolveMergeCommitSha } from './merge-commit.js';
import { resolveAvailableProviderId } from './provider-resolution.js';
import { buildReviewPrompt } from './review-prompt.js';
import { parseReviewVerdict } from './review-verdict.js';
import { LocalPRContext, type LocalPRAIDeps } from './context.js';
import { rm } from 'fs/promises';
import path from 'path';
import {
  getGitStatus,
  commitAllChanges,
  getNewCommits,
  getDiff,
  getMainBranch,
  getCurrentBranch,
  hasCommits,
  isWorkingTreeClean,
  mergeBranch,
  abortMerge,
  removeWorktree,
} from '../../utils/git-operations.js';

export type { LocalPRAIDeps };

// How long (ms) before a reviewing/merging PR is considered stale and reset
const STALE_TIMEOUT_MS = 30 * 60 * 1000;

// Maximum number of merged/closed PRs to keep per project
const MAX_FINISHED_PRS_PER_PROJECT = 10;

export class LocalPRService {
  private ctx: LocalPRContext;

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
  }

  // ---------------------------------------------------------------------------
  // PR Creation
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Review
  // ---------------------------------------------------------------------------

  /**
   * Start an AI review session for the given PR.
   * @param prId - The local PR to review
   * @param overrideProviderId - Optional provider ID (for manual trigger). Falls back to project.reviewLlmProfileId → project.defaultAgentProfileId.
   */
  async startReview(prId: string, overrideProviderId?: string): Promise<void> {
    const pr = this.ctx.prRepo.findById(prId);
    if (!pr) throw new Error(`Local PR not found: ${prId}`);

    const project = this.ctx.projectRepo.findById(pr.projectId);
    if (!project?.rootPath) throw new Error(`Project ${pr.projectId} has no rootPath`);

    // Precedence: explicit override > project.reviewLlmProfileId > project agent's LLM > default LLM.
    const agentLlmId = this.ctx.resolveAgentLlmIdForProject(pr.projectId);
    const llmProfileId = resolveAvailableProviderId(this.ctx.llmProfileRepo, [
      overrideProviderId,
      project.reviewLlmProfileId,
      agentLlmId,
    ]);
    if (!llmProfileId) {
      throw new Error(`No provider available for review on project ${pr.projectId}`);
    }

    if (!this.ctx.hasAvailableSlot(pr.projectId)) {
      this.ctx.prRepo.update(prId, {
        statusMessage: 'Queued for review: waiting for an available worktree slot.',
        executionState: 'queued',
        pendingAction: 'review',
      });
      this.ctx.broadcastPRUpdate(this.ctx.requirePR(prId));
      return;
    }

    // Has slot - mark as running
    this.ctx.prRepo.update(prId, {
      executionState: 'running',
      pendingAction: 'review',
    });

    if (this.ctx.activeReviewIds.has(prId)) {
      console.log(`[LocalPRService] Review already in progress for PR ${prId}`);
      return;
    }

    // Create background review session (read-only, hidden from sidebar).
    // agentProfileId auto-resolved by SessionRepository to default agent_profile.
    // llmProfileId is retained for downstream AI run dispatch (not stored on session).
    void llmProfileId;
    const session = this.ctx.sessionRepo.create({
      projectId: pr.projectId,
      name: `Review: ${pr.title}`,
      type: 'background',
      projectRole: 'review',
      workingDirectory: pr.worktreePath,
      isReadOnly: true,
    });

    this.ctx.prRepo.update(prId, { status: 'reviewing', reviewSessionId: session.id });
    this.ctx.broadcastToProject(pr.projectId, { type: 'sessions_created', session });
    this.ctx.broadcastPRUpdate(this.ctx.requirePR(prId));

    const reviewPrompt = await buildReviewPrompt(pr);
    this.ctx.activeReviewIds.add(prId);

    this.ctx.requireAiDeps().startAISession({
      clientId: `localpr_review_${prId}`,
      sessionId: session.id,
      input: reviewPrompt,
      workingDirectory: pr.worktreePath,
      llmProfileId,
      onMessage: (msg: ServerMessage) => {
        this.ctx.forwardSessionStream(pr.projectId, session.id, msg);
        if (msg.type === 'run_completed' || msg.type === 'run_failed') {
          this.onReviewSessionComplete(prId, session.id, msg.type === 'run_failed').catch(err =>
            console.error(`[LocalPRService] Review completion error for PR ${prId}:`, err)
          );
          this.ctx.activeReviewIds.delete(prId);
        }
      },
    });

    console.log(`[LocalPRService] Started review session ${session.id} for PR ${prId}`);
  }

  private async onReviewSessionComplete(
    prId: string,
    sessionId: string,
    runFailed = false
  ): Promise<void> {
    const pr = this.ctx.prRepo.findById(prId);
    if (!pr || pr.status !== 'reviewing') return;

    // Extract outcome from last assistant messages
    const messages = this.ctx.messageRepo.listRecentAssistantContents(sessionId, 5);

    const verdict = parseReviewVerdict(messages);
    const { sawExplicitVerdict } = verdict;
    let { passed, reviewNotes } = verdict;

    // Clean review temp artifacts before final status/commit checks.
    await this.cleanupReviewArtifacts(pr).catch(err =>
      console.warn(`[LocalPRService] Failed to cleanup review artifacts for PR ${prId}:`, err)
    );

    // Enforce clean worktree after review by auto-committing any remaining changes.
    let autoCommitError: string | null = null;
    try {
      const status = await getGitStatus(pr.worktreePath);
      if (status.hasChanges) {
        await commitAllChanges(pr.worktreePath);
        console.log(`[LocalPRService] Auto-committed remaining review changes for PR ${prId}`);
      }
    } catch (err) {
      autoCommitError = err instanceof Error ? err.message : 'Failed to auto-commit review changes';
      console.error(`[LocalPRService] ${autoCommitError}`);
    }

    if (autoCommitError) {
      passed = false;
      const prefix = reviewNotes ? `${reviewNotes}\n\n` : '';
      reviewNotes =
        `${prefix}Review left uncommitted changes and auto-commit failed: ${autoCommitError}`.slice(
          -2000
        );
    } else if (!sawExplicitVerdict && runFailed) {
      passed = false;
      if (!reviewNotes) {
        reviewNotes = 'Review session failed before producing a valid verdict marker.';
      }
    } else if (!sawExplicitVerdict && !runFailed) {
      // Backward compatibility: if run completed without explicit marker and no errors,
      // treat as passed after enforcing clean git state above.
      passed = true;
    }

    const newStatus: LocalPRStatus = passed ? 'approved' : 'review_failed';
    this.ctx.prRepo.update(prId, {
      status: newStatus,
      reviewNotes: reviewNotes || undefined,
      statusMessage: passed
        ? 'Review approved. Ready to merge.'
        : 'Review failed. Please address comments.',
      executionState: 'idle',
      pendingAction: 'none',
    });
    this.ctx.broadcastPRUpdate(this.ctx.requirePR(prId));
    console.log(`[LocalPRService] Review complete for PR ${prId}: ${newStatus}`);

    // Check for commits that arrived during the review
    await this.ctx.refreshAfterBusyState(prId, { resetReviewStateOnCommitChange: false });
  }

  private async cleanupReviewArtifacts(pr: LocalPR): Promise<void> {
    const relPath = path.join('.zclaudia', 'local-pr-review', `${pr.id}.diff.patch`);
    const absPath = path.join(pr.worktreePath, relPath);
    await rm(absPath, { force: true });
  }

  // ---------------------------------------------------------------------------
  // Merge
  // ---------------------------------------------------------------------------

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
          await this.startConflictResolution(prId);
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

  /** Manually trigger AI conflict-resolution session for a conflict PR. */
  async triggerConflictResolution(prId: string): Promise<void> {
    const pr = this.ctx.prRepo.findById(prId);
    if (!pr) throw new Error(`Local PR not found: ${prId}`);
    if (pr.status !== 'conflict')
      throw new Error(`Cannot resolve conflict in status '${pr.status}'`);
    const project = this.ctx.projectRepo.findById(pr.projectId);
    if (!project?.rootPath) throw new Error(`Project ${pr.projectId} has no rootPath`);
    if (!this.ctx.hasAvailableSlot(pr.projectId)) {
      this.ctx.prRepo.update(prId, {
        statusMessage: 'Queued for AI conflict resolution: waiting for an available worktree slot.',
        executionState: 'queued',
        pendingAction: 'resolve_conflict',
      });
      this.ctx.broadcastPRUpdate(this.ctx.requirePR(prId));
      return;
    }
    // Precedence: project.reviewLlmProfileId > project agent's LLM > default LLM.
    const agentLlmId = this.ctx.resolveAgentLlmIdForProject(pr.projectId);
    const llmProfileId = resolveAvailableProviderId(this.ctx.llmProfileRepo, [
      project.reviewLlmProfileId,
      agentLlmId,
    ]);
    if (!llmProfileId)
      throw new Error(`No provider available for conflict resolution on project ${pr.projectId}`);
    await this.startConflictResolution(prId, llmProfileId);
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

  // ---------------------------------------------------------------------------
  // Conflict Resolution
  // ---------------------------------------------------------------------------

  /**
   * Start an AI session to resolve merge conflicts for the given PR.
   * The AI rebases the feature branch onto the base branch in the feature worktree.
   * Merge is left to the normal mergePR flow after re-review.
   */
  async startConflictResolution(prId: string, overrideProviderId?: string): Promise<void> {
    const pr = this.ctx.prRepo.findById(prId);
    if (!pr) return;

    const project = this.ctx.projectRepo.findById(pr.projectId);
    if (!project?.rootPath) return;

    // Precedence: explicit override > project.reviewLlmProfileId > project agent's LLM > default LLM.
    const agentLlmId = this.ctx.resolveAgentLlmIdForProject(pr.projectId);
    const llmProfileId = resolveAvailableProviderId(this.ctx.llmProfileRepo, [
      overrideProviderId,
      project.reviewLlmProfileId,
      agentLlmId,
    ]);
    if (!llmProfileId) {
      console.warn(`[LocalPRService] No provider for conflict resolution on PR ${prId}`);
      return;
    }
    if (this.ctx.activeConflictIds.has(prId)) {
      console.log(`[LocalPRService] Conflict resolution already in progress for PR ${prId}`);
      return;
    }

    // llmProfileId used downstream for AI run; agentProfileId auto-resolved by SessionRepository.
    const session = this.ctx.sessionRepo.create({
      projectId: pr.projectId,
      name: `Conflict resolution: ${pr.title}`,
      type: 'background',
      projectRole: 'review',
      workingDirectory: pr.worktreePath,
      isReadOnly: true,
    });

    this.ctx.prRepo.update(prId, {
      conflictSessionId: session.id,
      statusMessage: 'AI conflict resolution started. Check the review session for progress.',
      executionState: 'running',
      pendingAction: 'resolve_conflict',
    });
    this.ctx.broadcastPRUpdate(this.ctx.requirePR(prId));
    this.ctx.broadcastToProject(pr.projectId, { type: 'sessions_created', session });

    const conflictPrompt = buildConflictResolutionPrompt({
      branchName: pr.branchName,
      baseBranch: pr.baseBranch,
    });

    this.ctx.activeConflictIds.add(prId);

    try {
      this.ctx.requireAiDeps().startAISession({
        clientId: `localpr_conflict_${prId}`,
        sessionId: session.id,
        input: conflictPrompt,
        workingDirectory: pr.worktreePath,
        llmProfileId,
        onMessage: (msg: ServerMessage) => {
          this.ctx.forwardSessionStream(pr.projectId, session.id, msg);
          if (msg.type === 'run_completed' || msg.type === 'run_failed') {
            this.onConflictSessionComplete(prId, session.id).catch(err =>
              console.error(`[LocalPRService] Conflict completion error for PR ${prId}:`, err)
            );
            this.ctx.activeConflictIds.delete(prId);
          }
        },
      });
    } catch (err) {
      this.ctx.activeConflictIds.delete(prId);
      const message = err instanceof Error ? err.message : 'Unknown startup error';
      this.ctx.prRepo.update(prId, {
        statusMessage: `Failed to start AI conflict resolution: ${message}`,
      });
      this.ctx.broadcastPRUpdate(this.ctx.requirePR(prId));
      throw err;
    }

    console.log(
      `[LocalPRService] Started conflict resolution session ${session.id} for PR ${prId}`
    );
  }

  private async onConflictSessionComplete(prId: string, sessionId: string): Promise<void> {
    const pr = this.ctx.prRepo.findById(prId);
    if (!pr || pr.status !== 'conflict') return;

    const messages = this.ctx.messageRepo.listRecentAssistantContents(sessionId, 5);

    const resolved = messages.some(m => /\[CONFLICT_RESOLVED\]/i.test(m.content));

    if (resolved) {
      // Reset to open so the PR goes through review again (rebase changed the code)
      this.ctx.prRepo.update(prId, {
        status: 'open',
        statusMessage: 'Conflict resolved. Re-review and merge again.',
        executionState: 'idle',
        pendingAction: 'none',
      });
      this.ctx.broadcastPRUpdate(this.ctx.requirePR(prId));
      console.log(
        `[LocalPRService] Conflict resolved for PR ${prId}, returning to open for re-review`
      );

      // Check for commits that arrived during conflict resolution
      await this.ctx.refreshAfterBusyState(prId);
    } else {
      // Leave as conflict — user must handle manually
      console.warn(`[LocalPRService] Conflict could not be resolved for PR ${prId}`);
      this.ctx.prRepo.update(prId, {
        statusMessage: 'AI could not resolve conflict. Resolve manually, then retry merge.',
        executionState: 'failed',
        executionError: 'AI could not resolve conflict',
      });
      this.ctx.broadcastPRUpdate(this.ctx.requirePR(prId));
    }
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
