import type { Database } from 'better-sqlite3';
import type { BranchAction } from '@zclaudia/shared/wire/messages';
import type { TaskCoordinationPort } from './task-coordination-port.js';
import { resolveAgentForSession } from '../../domains/agent-profiles/agent-resolver.js';
import { SessionRepository } from '../../domains/sessions/repository.js';

type BranchCoordinator = Pick<
  TaskCoordinationPort,
  'allocateBranch' | 'setActiveBranchId' | 'attachSession'
>;

export interface AllocateInlineSessionInput {
  hostProjectId: string;
  activeBranchId?: string | null;
  forceNew?: boolean;
  title: string;
  freshSessionId: string;
  input: string;
  workingDirectory?: string;
}

export interface InlineSessionAllocation {
  sessionId: string;
  branchId: string;
  branchAction: BranchAction;
  contextReset?: boolean;
  isSessionReuse: boolean;
}

export class ClaudiaInlineSessionAllocationService {
  constructor(
    private readonly db: Database,
    private readonly branchCoordinator: BranchCoordinator
  ) {}

  allocate(input: AllocateInlineSessionInput): InlineSessionAllocation {
    return this.db.transaction(() => {
      const allocation = this.branchCoordinator.allocateBranch({
        hostProjectId: input.hostProjectId,
        activeBranchId: input.activeBranchId,
        forceNew: input.forceNew,
        title: input.title,
        sessionId: input.freshSessionId,
      });

      const sessionId = allocation.sessionId;
      const isSessionReuse = allocation.action === 'reused' && sessionId !== input.freshSessionId;

      if (allocation.action !== 'forked') {
        this.branchCoordinator.setActiveBranchId(input.hostProjectId, allocation.branchId);
      }

      if (!isSessionReuse) {
        const { agent } = resolveAgentForSession(this.db, { projectId: input.hostProjectId });
        const sessionRepo = new SessionRepository(this.db);
        sessionRepo.createWithId(sessionId, {
          projectId: input.hostProjectId,
          name: `Claudia: ${input.input.slice(0, 50)}`,
          agentProfileId: agent.id,
          type: 'agent',
          workingDirectory: input.workingDirectory,
        });
        this.branchCoordinator.attachSession(allocation.branchId, sessionId);
      }

      return {
        sessionId,
        branchId: allocation.branchId,
        branchAction: allocation.action,
        contextReset: allocation.contextReset,
        isSessionReuse,
      };
    })();
  }
}
