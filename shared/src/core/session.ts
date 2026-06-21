// Session Types

export type SessionType = 'regular' | 'background' | 'agent';

export interface Session {
  id: string;
  projectId: string;
  name?: string;
  /** AI-generated topic title shown in the header chip. Distinct from `name`. */
  autoTitle?: string;
  /** User-message count at the moment `autoTitle` was last generated. */
  autoTitleMsgCount?: number;
  /** FK to agent_profiles.id (NOT NULL on the server schema). Optional in the
   *  shared type to accommodate sync payloads that omit it; populated by the
   *  server before any session can be persisted. */
  agentProfileId?: string;
  sdkSessionId?: string | null;
  type: SessionType;                // 'regular' = user-facing, 'background' = autonomous task
  parentSessionId?: string;          // Which session spawned this one (for background sessions)
  workingDirectory?: string;         // Session-specific working directory (e.g., for git worktree)
  sortOrder?: number;
  createdAt: number;
  updatedAt: number;
  isActive?: boolean;  // Whether this session has an active AI request running
  archivedAt?: number; // Timestamp when session was archived, undefined = not archived

  // Supervision v2
  projectRole?: 'main' | 'task' | 'review' | 'checkpoint' | 'scheduled' | 'workflow';
  taskId?: string;
  planStatus?: 'planning' | 'planned' | 'executing' | null;
  isReadOnly?: boolean;
  lastRunStatus?: 'running' | 'waiting' | 'interrupted' | null;
  /** Cross-session fork lineage: the session this was forked from (SP-A). NULL once the source is deleted. */
  forkedFromSessionId?: string;
  /** The source tree entry id this session was forked at (SP-A). */
  forkEntryId?: string;
}

// Session Draft Types

export interface SessionDraft {
  id: string;
  sessionId: string;
  content: string;
  editingBy?: string;    // Device ID currently editing (for edit locking)
  editingAt?: number;    // Lock timestamp
  updatedAt: number;
  archivedAt?: number;
}
