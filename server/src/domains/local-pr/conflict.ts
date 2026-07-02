import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { LocalPRContext } from './context.js';
import { buildConflictResolutionPrompt } from './conflict-resolution-prompt.js';
import { resolveAvailableProviderId } from './provider-resolution.js';

export class PRConflictService {
  constructor(private ctx: LocalPRContext) {}

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

  async onConflictSessionComplete(prId: string, sessionId: string): Promise<void> {
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
}
