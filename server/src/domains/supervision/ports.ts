import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { Project } from '@zclaudia/shared/core/project';
import type { Session } from '@zclaudia/shared/core/session';
import type { ProjectAgent } from '@zclaudia/shared/features/supervision';

// ── AI Execution ─────────────────────────────────────────────────────

export interface SupervisionAiRunPort {
  startVirtualRun(args: {
    clientId: string;
    sessionId: string;
    input: string;
    workingDirectory: string;
    onMessage: (msg: ServerMessage) => void;
  }): Promise<void> | void;
}

// ── Scheduling ───────────────────────────────────────────────────────

export interface SupervisionSchedulingPort {
  register(task: {
    id: string;
    name: string;
    description?: string;
    category?: string;
    intervalMs?: number;
  }): void;
  markRunStart(taskId: string): void;
  markRunComplete(taskId: string, durationMs: number, error?: string): void;
}

// ── Cross-domain: Projects ───────────────────────────────────────────

/** What supervision needs from the projects domain — no concrete repo import */
export interface SupervisionProjectPort {
  findById(id: string): Project | undefined;
  findAll(): Project[];
  update(id: string, data: { agent?: ProjectAgent | null; contextSyncStatus?: 'synced' | 'error' }): Project;
}

// ── Cross-domain: Sessions ───────────────────────────────────────────

/** What supervision needs from the sessions domain — CRUD + role queries */
export interface SupervisionSessionPort {
  findById(id: string): Session | undefined;
  create(data: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>): Session;
  update(id: string, data: Partial<Omit<Session, 'id' | 'createdAt' | 'updatedAt'>>): Session;
  findByProjectRole(projectId: string, role: string): Session[];
}

/** Session model helpers that supervision needs to build task sessions */
export interface SupervisionSessionModelPort {
  buildTaskPlanningSession(seed: {
    projectId: string;
    title: string;
    taskId: string;
    agentProfileId: string;
    parentSessionId?: string;
    workingDirectory?: string;
  }): Omit<Session, 'id' | 'createdAt' | 'updatedAt'>;
  buildTaskExecutingSessionPatch(workingDirectory: string): Partial<Session>;
  buildTaskPlannedSessionPatch(): Partial<Session>;
  buildTaskUnlockedSessionPatch(): Partial<Session>;
}
