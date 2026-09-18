import type { BranchAction } from '@zclaudia/shared/wire/messages';

/** Branch record subset the Claudia P0 target resolution needs. */
export interface CoordinationBranchView {
  id: string;
  hostProjectId: string;
  activeSessionId: string | null;
}

export interface TaskCoordinationPort {
  allocateBranch(opts: {
    hostProjectId: string;
    activeBranchId?: string | null;
    forceNew?: boolean;
    title: string;
    sessionId: string;
  }): {
    branchId: string;
    sessionId: string;
    action: 'reused' | 'forked' | 'created';
    contextReset?: boolean;
  };
  /** Look up an existing discussion thread (branch) without allocating. */
  findBranch(branchId: string): CoordinationBranchView | null;
  /** Create a new thread (P0 new-topic path). Session is attached later. */
  createBranch(opts: { hostProjectId: string; title: string }): { id: string };
  allocateForContinue(opts: {
    taskBranchId: string | null;
    hostProjectId: string;
    title: string;
    sessionId: string;
  }): {
    branchId: string;
    sessionId: string;
    action: 'reused' | 'forked' | 'created';
    contextReset?: boolean;
  };
  setActiveBranchId(hostProjectId: string, branchId: string | null): void;
  attachSession(branchId: string, sessionId: string): void;
  updateBranchTask(branchId: string, taskId: string, sessionId?: string): void;
  submitCanonicalAgentTask(input: {
    input: string;
    title: string;
    projectId: string;
    llmProfileId?: string;
    branchId: string;
    branchAction: BranchAction;
    contextReset?: boolean;
  }): Promise<{ taskId: string; sessionId: string }>;
  getCanonicalAgentTask(taskId: string):
    | {
        taskId: string;
        projectId: string | null;
        branchId: string | null;
        llmProfileId?: string;
      }
    | undefined;
  continueCanonicalAgentTask(input: {
    parentTaskId: string;
    input: string;
    title: string;
    projectId: string;
    llmProfileId?: string;
    branchId: string;
    branchAction: BranchAction;
    contextReset?: boolean;
  }): Promise<{ taskId: string; sessionId: string }>;
  cancelCanonicalAgentTask(taskId: string): Promise<boolean>;
}
