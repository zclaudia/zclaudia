import type { LocalPR, LocalPRStatus } from '@zclaudia/shared/features/local-pr';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { LocalPRContext } from './context.js';
import { resolveAvailableProviderId } from './provider-resolution.js';
import { buildReviewPrompt } from './review-prompt.js';
import { parseReviewVerdict } from './review-verdict.js';
import { rm } from 'fs/promises';
import path from 'path';
import { getGitStatus, commitAllChanges } from '../../utils/git-operations.js';

export class PRReviewService {
  constructor(private ctx: LocalPRContext) {}

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

  async onReviewSessionComplete(prId: string, sessionId: string, runFailed = false): Promise<void> {
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

  async cleanupReviewArtifacts(pr: LocalPR): Promise<void> {
    const relPath = path.join('.zclaudia', 'local-pr-review', `${pr.id}.diff.patch`);
    const absPath = path.join(pr.worktreePath, relPath);
    await rm(absPath, { force: true });
  }
}
