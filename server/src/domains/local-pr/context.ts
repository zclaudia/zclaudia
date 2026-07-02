import type { Database } from 'better-sqlite3';
import type { LocalPR, LocalPRStatus } from '@zclaudia/shared/features/local-pr';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import { LocalPRRepository } from './repository.js';
import { ProjectRepository } from '../projects/repository.js';
import { LlmProfileRepository } from '../llm-profiles/repository.js';
import { SessionRepository } from '../sessions/repository.js';
import { SessionMessageRepository } from '../sessions/message-repository.js';
import { resolveAgentForSession, NoAgentAvailableError } from '../agent-profiles/agent-resolver.js';
import type { LocalPRAiSessionPort } from './ports.js';
import { WorktreeConfigRepository } from '../../infra/repositories/worktree-config.js';
import { Mutex } from 'async-mutex';
import {
  getNewCommits,
  getDiff,
  getMainBranch,
  getCurrentBranch,
} from '../../utils/git-operations.js';

const LOCAL_PR_SESSION_STREAM_MESSAGE_TYPES = new Set<ServerMessage['type']>([
  'run_started',
  'delta',
  'tool_use',
  'tool_result',
  'mode_change',
  'task_notification',
  'system_info',
  'run_completed',
  'run_failed',
]);

export interface LocalPRAIDeps {
  startAISession: LocalPRAiSessionPort['startAISession'];
  isProjectSlotAvailable?: (projectId: string) => boolean;
}

export class LocalPRContext {
  readonly prRepo: LocalPRRepository;
  readonly projectRepo: ProjectRepository;
  readonly llmProfileRepo: LlmProfileRepository;
  readonly sessionRepo: SessionRepository;
  readonly messageRepo: SessionMessageRepository;
  readonly wtConfigRepo: WorktreeConfigRepository;
  readonly mergeLock = new Mutex();
  readonly activeReviewIds = new Set<string>();
  readonly activeConflictIds = new Set<string>();

  constructor(
    readonly db: Database,
    readonly broadcastToProject: (projectId: string, message: ServerMessage) => void,
    readonly aiDeps?: LocalPRAIDeps
  ) {
    this.prRepo = new LocalPRRepository(db);
    this.projectRepo = new ProjectRepository(db);
    this.llmProfileRepo = new LlmProfileRepository(db);
    this.sessionRepo = new SessionRepository(db);
    this.messageRepo = new SessionMessageRepository(db);
    this.wtConfigRepo = new WorktreeConfigRepository(db);
  }

  requirePR(prId: string): LocalPR {
    const pr = this.prRepo.findById(prId);
    if (!pr) throw new Error(`Local PR not found: ${prId}`);
    return pr;
  }

  requireAiDeps(): LocalPRAIDeps {
    if (!this.aiDeps) throw new Error('Local PR AI dependencies are not configured');
    return this.aiDeps;
  }

  /**
   * Archive review/conflict sessions associated with a PR.
   * Called when a PR is merged or closed — the sessions are no longer relevant.
   */
  archiveRelatedSessions(pr: LocalPR): void {
    const now = Date.now();
    const sessionIds = [pr.reviewSessionId, pr.conflictSessionId].filter(Boolean) as string[];
    if (sessionIds.length === 0) return;

    for (const sid of sessionIds) {
      this.sessionRepo.archiveIfActive(sid, now);
    }
    console.log(`[LocalPRService] Archived ${sessionIds.length} session(s) for PR ${pr.id}`);
  }

  /**
   * Refresh an existing PR's commits and diff if it's in a safe state.
   * Skips update when the PR is being reviewed or merged to avoid interfering.
   */
  async maybeRefreshPR(
    pr: LocalPR,
    rootPath: string,
    commits: Array<{ sha: string; message: string }>,
    baseBranch: string,
    branchName: string,
    options: { resetReviewStateOnCommitChange?: boolean } = {}
  ): Promise<LocalPR | null> {
    // Don't touch PRs that are currently being processed
    const busyStatuses: LocalPRStatus[] = ['reviewing', 'merging', 'conflict'];
    if (busyStatuses.includes(pr.status)) {
      console.log(`[LocalPRService] PR ${pr.id} is ${pr.status}, skipping refresh`);
      return null;
    }

    const newShas = commits.map(c => c.sha);
    const oldShas = pr.commits ?? [];

    // Nothing changed
    if (newShas.length === oldShas.length && newShas.every((s, i) => s === oldShas[i])) {
      return null;
    }

    const diffSummary = await getDiff(rootPath, baseBranch, branchName);

    const shouldResetReviewState = options.resetReviewStateOnCommitChange ?? true;
    // If review was done on old commits, reset to open so it can be re-reviewed.
    // When commit changes are produced by the review session itself, caller can preserve the verdict.
    const newStatus: LocalPRStatus =
      shouldResetReviewState && (pr.status === 'approved' || pr.status === 'review_failed')
        ? 'open'
        : pr.status;

    const updated = this.prRepo.update(pr.id, {
      commits: newShas,
      diffSummary,
      status: newStatus,
    });

    this.broadcastPRUpdate(updated);
    console.log(
      `[LocalPRService] Refreshed PR ${pr.id}: ${oldShas.length} → ${newShas.length} commits${newStatus !== pr.status ? `, status ${pr.status} → ${newStatus}` : ''}`
    );
    return updated;
  }

  /**
   * After a PR transitions out of a busy state (reviewing/merging/conflict),
   * check if the worktree has new commits that need to be captured.
   */
  async refreshAfterBusyState(
    prId: string,
    options: { resetReviewStateOnCommitChange?: boolean } = {}
  ): Promise<void> {
    try {
      const pr = this.prRepo.findById(prId);
      if (!pr) return;

      const project = this.projectRepo.findById(pr.projectId);
      if (!project?.rootPath) return;

      const baseBranch = await getMainBranch(pr.worktreePath);
      const branchName = await getCurrentBranch(pr.worktreePath);
      if (branchName === baseBranch) return;

      const commits = await getNewCommits(project.rootPath, branchName, baseBranch);
      if (commits.length === 0) return;

      await this.maybeRefreshPR(pr, project.rootPath, commits, baseBranch, branchName, options);
    } catch (err) {
      console.error(`[LocalPRService] refreshAfterBusyState error for PR ${prId}:`, err);
    }
  }

  /** Permanently delete sessions associated with a PR. */
  deleteRelatedSessions(pr: LocalPR): void {
    const sessionIds = [pr.reviewSessionId, pr.conflictSessionId].filter(Boolean) as string[];
    for (const sid of sessionIds) {
      try {
        this.sessionRepo.delete(sid);
      } catch {
        // Session may already be deleted
      }
    }
  }

  broadcastPRUpdate(pr: LocalPR): void {
    this.broadcastToProject(pr.projectId, {
      type: 'local_pr_update',
      projectId: pr.projectId,
      pr,
    });
  }

  forwardSessionStream(projectId: string, sessionId: string, msg: ServerMessage): void {
    if (!LOCAL_PR_SESSION_STREAM_MESSAGE_TYPES.has(msg.type)) return;
    const messageSessionId = (msg as { sessionId?: string }).sessionId;
    // system_info currently has no sessionId field; tag it with this virtual session.
    if (messageSessionId && messageSessionId !== sessionId) return;
    if (!messageSessionId && msg.type !== 'system_info') return;
    if (!messageSessionId && msg.type === 'system_info') {
      this.broadcastToProject(projectId, { ...msg, sessionId } as ServerMessage);
      return;
    }
    this.broadcastToProject(projectId, msg);
  }

  /**
   * Resolve the LLM profile id from the project's default agent. Returns undefined
   * if no agent is available (caller falls through to llm-profile default).
   *
   * Used by the review/conflict-resolution paths where the project's agent decides
   * which LLM serves as the last-resort reviewer when no explicit
   * `reviewLlmProfileId` is configured.
   */
  resolveAgentLlmIdForProject(projectId: string): string | undefined {
    try {
      const { llm } = resolveAgentForSession(this.db, { projectId });
      return llm?.id;
    } catch (err) {
      if (err instanceof NoAgentAvailableError) {
        return undefined;
      }
      throw err;
    }
  }

  hasAvailableSlot(projectId: string): boolean {
    if (!this.aiDeps?.isProjectSlotAvailable) return true;
    try {
      return this.aiDeps.isProjectSlotAvailable(projectId);
    } catch {
      return true;
    }
  }
}
