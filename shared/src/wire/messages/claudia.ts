// Claudia Task protocol messages

export type ClaudiaTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type BranchAction = 'reused' | 'forked' | 'created';

// Client → Server: submit a new Claudia task
export interface ClaudiaTaskSubmitMessage {
  type: 'claudia_task_submit';
  clientRequestId: string;
  sessionId: string; // Claudia hub session
  input: string;
  projectId: string;
  llmProfileId?: string;
  activeBranchId?: string;
  forceNewBranch?: boolean;
}

// Client → Server: continue an existing task
export interface ClaudiaTaskContinueMessage {
  type: 'claudia_task_continue';
  clientRequestId: string;
  taskId: string; // Original task ID
  sessionId: string; // Original task's backend session
  input: string; // Follow-up instruction
}

// Client → Server: cancel an existing Claudia task
export interface ClaudiaTaskCancelMessage {
  type: 'claudia_task_cancel';
  taskId: string;
}

// Server → Client: task created confirmation
export interface ClaudiaTaskCreatedMessage {
  type: 'claudia_task_created';
  clientRequestId: string;
  taskId: string;
  projectId: string;
  sessionId: string; // Backend task session
  branchId: string; // Branch this task belongs to
  branchAction: BranchAction; // Whether branch was reused/forked/created
  title: string;
  status: 'queued';
  contextReset?: boolean; // True if session resume failed (context lost)
}

export interface ClaudiaTaskSnapshotTask {
  id: string;
  sessionId: string | null;
  branchId: string | null;
  branchAction?: BranchAction;
  contextReset?: boolean;
  input: string;
  title: string;
  status: ClaudiaTaskStatus;
  summary?: string;
  error?: string;
  responseText?: string;
  toolCount?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ClaudiaActiveBranchState {
  projectId: string;
  branchId: string;
}

// Server → Client: full/partial Claudia task snapshot for state recovery
export interface ClaudiaTaskSnapshotMessage {
  type: 'claudia_task_snapshot';
  tasks: ClaudiaTaskSnapshotTask[];
  activeBranches: ClaudiaActiveBranchState[];
}

// Server → Client: task status update
export interface ClaudiaTaskUpdateMessage {
  type: 'claudia_task_update';
  taskId: string;
  status: ClaudiaTaskStatus;
  sessionId?: string;
  branchId?: string;
  branchAction?: BranchAction;
  contextReset?: boolean;
  input?: string;
  title?: string;
  createdAt?: number;
  updatedAt?: number;
  summary?: string;
  error?: string;
  responseText?: string; // Full assistant response (on completion)
  toolCount?: number; // Number of tool calls made
}

// Server → Client: streaming text for a running task
export interface ClaudiaTaskDeltaMessage {
  type: 'claudia_task_delta';
  taskId: string;
  content: string;
}

// Client → Server: send a message to Claudia (inline first, may promote to task)
export interface ClaudiaMessageMessage {
  type: 'claudia_message';
  clientRequestId: string;
  input: string;
  projectId: string;
  contextProjectIds?: string[];
  primaryContextProjectId?: string;
  llmProfileId?: string;
  /** Explicitly selected agent profile for a new conversation (P0 §默认 agent).
   *  Absent/undefined = use the project default → global default chain. The
   *  server must NOT silently fall back when an explicit id is unusable. */
  agentProfileId?: string;
  activeBranchId?: string; // Current active branch for reuse/fork decision
  forceNewBranch?: boolean; // Force create new branch (new conversation)
}

// How the server resolved the agent profile that backs a Claudia session/request.
export type ClaudiaAgentProfileSource =
  | 'explicit'
  | 'project-default'
  | 'global-default'
  | 'session-bound';

// Server → Client: accepted run receipt (P0 身份契约). Sent after the target
// session passed admission and the request record was persisted — carries the
// stable identity the UI binds to before any body text arrives.
export interface ClaudiaRequestAcceptedMessage {
  type: 'claudia_request_accepted';
  userMessageId?: string;
  assistantMessageId?: string;
  clientRequestId: string;
  projectId: string;
  branchId: string;
  sessionId: string;
  runId: string;
  branchAction: BranchAction;
  contextReset?: boolean;
  /** Agent profile actually bound server-side; may differ from an explicit pick. */
  agentProfileId: string;
  agentProfileSource: ClaudiaAgentProfileSource;
  workingDirectory?: string;
  /** True when this receipt replays a previously accepted request (idempotent retry). */
  replay?: boolean;
}

export type ClaudiaRequestRejectionCode =
  | 'SESSION_BUSY'
  | 'DUPLICATE_CONFLICT'
  | 'PROJECT_NOT_FOUND'
  | 'CONTEXT_PROJECT_NOT_FOUND'
  | 'NO_AGENT_AVAILABLE'
  | 'AGENT_UNAVAILABLE'
  | 'INPUT_TOO_LARGE'
  | 'RUN_START_FAILED'
  | 'THREAD_NOT_FOUND';

// Server → Client: structured start rejection (P0 身份契约). The client stops
// its submitting state and keeps the draft; no run or task was created unless
// the code says the request was already accepted (see DUPLICATE_CONFLICT).
export interface ClaudiaRequestRejectedMessage {
  type: 'claudia_request_rejected';
  clientRequestId: string;
  code: ClaudiaRequestRejectionCode;
  error: string;
  projectId?: string;
  branchId?: string;
  /** Target session the request was bound to when rejected. */
  sessionId?: string;
  /** Current run occupying the session (code === 'SESSION_BUSY'). */
  runId?: string;
}

// Server → Client: streaming text for inline response
export interface ClaudiaMessageDeltaMessage {
  type: 'claudia_message_delta';
  seq?: number;
  clientRequestId: string;
  content: string;
  /** Run identity — stable across the whole reply (P0 身份契约). */
  sessionId?: string;
  runId?: string;
}

// Server → Client: inline response completed (no tool use, fast)
export interface ClaudiaMessageCompletedMessage {
  type: 'claudia_message_completed';
  clientRequestId: string;
  responseText: string;
  sessionId?: string;
  runId?: string;
}

// Server → Client: inline response failed before promotion
export interface ClaudiaMessageFailedMessage {
  type: 'claudia_message_failed';
  clientRequestId: string;
  error: string;
  sessionId?: string;
  runId?: string;
  code?: ClaudiaRequestRejectionCode | string;
}

// Server → Client: inline response promoted to background task
export interface ClaudiaMessagePromotedMessage {
  type: 'claudia_message_promoted';
  clientRequestId: string;
  taskId: string;
  projectId: string;
  sessionId: string;
  branchId: string;
  branchAction: BranchAction;
  contextReset?: boolean;
}

export type ClaudiaClientMessage =
  | ClaudiaTaskSubmitMessage
  | ClaudiaTaskContinueMessage
  | ClaudiaTaskCancelMessage
  | ClaudiaMessageMessage;

export type ClaudiaServerMessage =
  | ClaudiaTaskCreatedMessage
  | ClaudiaTaskSnapshotMessage
  | ClaudiaTaskUpdateMessage
  | ClaudiaTaskDeltaMessage
  | ClaudiaRequestAcceptedMessage
  | ClaudiaRequestRejectedMessage
  | ClaudiaMessageDeltaMessage
  | ClaudiaMessageCompletedMessage
  | ClaudiaMessageFailedMessage
  | ClaudiaMessagePromotedMessage;
