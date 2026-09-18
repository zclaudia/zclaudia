import type { Database } from 'better-sqlite3';
import type { BranchAction, ClaudiaAgentProfileSource } from '@zclaudia/shared/wire/messages';
import type { TaskCoordinationPort } from './task-coordination-port.js';
import { resolveAgentForSession } from '../../domains/sessions/agent-resolver.js';
import { SessionRepository } from '../../domains/sessions/repository.js';

type BranchCoordinator = Pick<
  TaskCoordinationPort,
  'allocateBranch' | 'findBranch' | 'createBranch' | 'setActiveBranchId' | 'attachSession'
>;

/** An explicitly selected agent profile cannot back a new session (P0 §默认 agent:
 *  the server must return an actionable error instead of silently falling back). */
export class AgentProfileUnavailableError extends Error {
  readonly code = 'AGENT_UNAVAILABLE';
  constructor(agentId: string, reason: string) {
    super(`Selected agent is unavailable (${reason}): ${agentId}`);
    this.name = 'AgentProfileUnavailableError';
  }
}

/** Target session already has a non-terminal run (design §忙碌时的行为, P0).
 *  The request is rejected with the occupying run id — never auto-forked. */
export class ClaudiaSessionBusyError extends Error {
  readonly code = 'SESSION_BUSY';
  constructor(
    readonly sessionId: string,
    readonly runId: string | null
  ) {
    super(`Session is busy (runId: ${runId ?? 'unknown'})`);
    this.name = 'ClaudiaSessionBusyError';
  }
}

export class ClaudiaThreadUnavailableError extends Error {
  constructor() {
    super('The selected conversation is unavailable. Start a new topic explicitly to continue.');
  }
}

export interface AllocateInlineSessionInput {
  hostProjectId: string;
  activeBranchId?: string | null;
  forceNew?: boolean;
  title: string;
  freshSessionId: string;
  input: string;
  workingDirectory?: string;
  /** Explicit user-selected profile for a new conversation. Validated strictly:
   *  missing or read-only profiles reject the request — no silent fallback. */
  explicitAgentId?: string;
  /** Runtime admission predicate: returns the occupying run id when the session
   *  has a non-terminal run (busy check follows runs, not canonical tasks). */
  isSessionBusy?: (sessionId: string) => string | null;
}

export interface InlineSessionAllocation {
  sessionId: string;
  branchId: string;
  branchAction: BranchAction;
  contextReset?: boolean;
  isSessionReuse: boolean;
  agentProfileId: string;
  agentProfileSource: ClaudiaAgentProfileSource;
}

export class ClaudiaInlineSessionAllocationService {
  constructor(
    private readonly db: Database,
    private readonly branchCoordinator: BranchCoordinator
  ) {}

  /**
   * Resolve the discussion thread + session for a new Claudia message (P0:
   * discussion session == work session). Never forks a busy thread — a busy
   * target throws {@link ClaudiaSessionBusyError} and nothing is created.
   */
  allocate(input: AllocateInlineSessionInput): InlineSessionAllocation {
    return this.db.transaction(() => {
      // Validate an explicit pick BEFORE any branch/session rows are created so a
      // stale or read-only selection fails without leaving hidden state behind.
      let agentProfileSource: ClaudiaAgentProfileSource = 'global-default';
      if (input.explicitAgentId) {
        const agentRow = this.db
          .prepare('SELECT status FROM agent_profiles WHERE id = ?')
          .get(input.explicitAgentId) as { status: string } | undefined;
        if (!agentRow) {
          throw new AgentProfileUnavailableError(input.explicitAgentId, 'profile not found');
        }
        if (agentRow.status === 'readonly') {
          throw new AgentProfileUnavailableError(input.explicitAgentId, 'profile is read-only');
        }
        agentProfileSource = 'explicit';
      }

      const target = this.resolveTarget(input);

      if (target.action !== 'reused') {
        const { agent, source } = resolveAgentForSession(this.db, {
          projectId: input.hostProjectId,
          explicitAgentId: input.explicitAgentId,
        });
        const sessionRepo = new SessionRepository(this.db);
        sessionRepo.createWithId(target.sessionId, {
          projectId: input.hostProjectId,
          name: `Claudia: ${input.input.slice(0, 50)}`,
          agentProfileId: agent.id,
          type: 'agent',
          workingDirectory: input.workingDirectory,
        });
        this.branchCoordinator.attachSession(target.branchId, target.sessionId);
        agentProfileSource = input.explicitAgentId ? 'explicit' : (source ?? 'global-default');
      } else {
        // Reused session keeps its binding; the receipt reports it as such.
        agentProfileSource = 'session-bound';
      }

      // Project state pointer = "most recently visited thread" only; it never
      // overrides a client-opened thread.
      this.branchCoordinator.setActiveBranchId(input.hostProjectId, target.branchId);

      const boundProfileId = this.db
        .prepare('SELECT agent_profile_id FROM sessions WHERE id = ?')
        .get(target.sessionId) as { agent_profile_id: string } | undefined;

      return {
        sessionId: target.sessionId,
        branchId: target.branchId,
        branchAction: target.action,
        contextReset: target.contextReset,
        isSessionReuse: target.action === 'reused',
        agentProfileId: boundProfileId?.agent_profile_id ?? input.explicitAgentId ?? '',
        agentProfileSource,
      };
    })();
  }

  private resolveTarget(input: AllocateInlineSessionInput): {
    branchId: string;
    sessionId: string;
    action: 'reused' | 'created';
    contextReset?: boolean;
  } {
    if (!input.forceNew && input.activeBranchId) {
      const branch = this.branchCoordinator.findBranch(input.activeBranchId);
      if (branch && branch.hostProjectId === input.hostProjectId) {
        const existingSessionId = branch.activeSessionId;
        if (existingSessionId && this.sessionExists(existingSessionId)) {
          const busyRunId = input.isSessionBusy?.(existingSessionId) ?? null;
          if (busyRunId !== null) {
            throw new ClaudiaSessionBusyError(existingSessionId, busyRunId);
          }
          return { branchId: branch.id, sessionId: existingSessionId, action: 'reused' };
        }
        throw new ClaudiaThreadUnavailableError();
      }
      throw new ClaudiaThreadUnavailableError();
    }
    // New topic (or no usable target thread) — create an independent thread.
    const branch = this.branchCoordinator.createBranch({
      hostProjectId: input.hostProjectId,
      title: input.title,
    });
    return { branchId: branch.id, sessionId: input.freshSessionId, action: 'created' };
  }

  private sessionExists(sessionId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId));
  }
}
